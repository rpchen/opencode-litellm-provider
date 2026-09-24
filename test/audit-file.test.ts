import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, isAbsolute, basename } from "node:path"
import { auditDirectory, writeAuditFile } from "../src/host/audit-file.js"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "litellm-audit-test-"))
  directories.push(path)
  return path
}

describe("审查报告文件", () => {
  test("使用用户状态目录且输出绝对路径", async () => {
    const home = await directory()
    expect(auditDirectory({ XDG_STATE_HOME: home })).toBe(join(home, "opencode", "litellm-audit"))
    const path = await writeAuditFile({ schemaVersion: 1 }, join(home, "nested"))
    expect(isAbsolute(path)).toBeTrue()
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1 })
    expect(await readdir(join(home, "nested"))).toEqual([basename(path)])
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    } else {
      const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" })
        .match(/S-1-(?:\d+-)+\d+/)?.[0]
      expect(sid).toBeTruthy()
      for (const target of [join(home, "nested"), path]) {
        const rules = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
$acl = if ([System.IO.Directory]::Exists($env:OPENCODE_LITELLM_AUDIT_PATH)) {
  [System.IO.Directory]::GetAccessControl($env:OPENCODE_LITELLM_AUDIT_PATH)
} else {
  [System.IO.File]::GetAccessControl($env:OPENCODE_LITELLM_AUDIT_PATH)
}
@($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
  [pscustomobject]@{
    sid = $_.IdentityReference.Value
    rights = $_.FileSystemRights.ToString()
    inherited = $_.IsInherited
    type = $_.AccessControlType.ToString()
  }
}) | ConvertTo-Json -Compress
`], {
          encoding: "utf8",
          env: { ...process.env, OPENCODE_LITELLM_AUDIT_PATH: target },
        })
        expect(JSON.parse(rules)).toEqual({ sid, rights: "FullControl", inherited: false, type: "Allow" })
      }
    }
  })

  test("连续导出互不覆盖，旧文件保持完整", async () => {
    const home = await directory()
    const first = await writeAuditFile({ models: ["first"] }, home)
    const second = await writeAuditFile({ models: ["second"] }, home)
    expect(first).not.toBe(second)
    expect(JSON.parse(await readFile(first, "utf8"))).toEqual({ models: ["first"] })
    expect(JSON.parse(await readFile(second, "utf8"))).toEqual({ models: ["second"] })
  })

  test("序列化失败时清理已创建的临时文件且不覆盖旧报告", async () => {
    const home = await directory()
    const prior = await writeAuditFile({ value: "intact" }, home)
    const circular: { self?: unknown } = {}
    circular.self = circular
    await expect(writeAuditFile(circular, home)).rejects.toThrow()
    expect((await readdir(home))).toEqual([basename(prior)])
    expect(JSON.parse(await readFile(prior, "utf8"))).toEqual({ value: "intact" })
  })

  test("不可写的目标不留下临时文件或修改已有报告", async () => {
    const home = await directory()
    const original = join(home, "previous.json")
    await writeFile(original, "original")
    const block = join(home, "blocked")
    await writeFile(block, "file-not-directory")
    await expect(writeAuditFile({ models: [] }, block)).rejects.toThrow()
    expect(await readFile(original, "utf8")).toBe("original")
    expect((await readdir(home)).sort()).toEqual(["blocked", "previous.json"])
  })
})
