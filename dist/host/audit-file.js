import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
const execFile = promisify(execFileCallback);
const protectWindowsScript = `
$ErrorActionPreference = 'Stop'
$path = $env:OPENCODE_LITELLM_AUDIT_PATH
$isDirectory = [System.IO.Directory]::Exists($path)
$acl = if ($isDirectory) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
$acl.SetAccessRuleProtection($true, $false)
foreach ($entry in @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) {
  $acl.PurgeAccessRules($entry.IdentityReference)
}
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
if ($isDirectory) { [System.IO.Directory]::SetAccessControl($path, $acl) } else { [System.IO.File]::SetAccessControl($path, $acl) }
`;
async function protectWindowsFile(path) {
    if (process.platform !== "win32")
        return;
    await execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", protectWindowsScript], {
        windowsHide: true,
        env: { ...process.env, OPENCODE_LITELLM_AUDIT_PATH: path },
    });
}
export function auditDirectory(environment = process.env) {
    const state = environment.XDG_STATE_HOME
        ?? (process.platform === "win32"
            ? environment.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
            : join(homedir(), ".local", "state"));
    return resolve(state, "opencode", "litellm-audit");
}
export async function writeAuditFile(report, directory = auditDirectory()) {
    const destination = resolve(directory);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await protectWindowsFile(destination);
    const id = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomBytes(16).toString("hex")}`;
    const target = join(destination, `litellm-audit-${id}.json`);
    const temporary = join(destination, `.litellm-audit-${id}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
        try {
            await protectWindowsFile(temporary);
            await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await link(temporary, target);
        if (!isAbsolute(target))
            throw new Error("导出路径不是绝对路径");
        return target;
    }
    finally {
        await unlink(temporary);
    }
}
