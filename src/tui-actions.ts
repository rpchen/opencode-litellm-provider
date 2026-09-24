import { execFile as callback, spawn } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(callback)

type Runner = typeof execFile

export async function openAuditReport(path: string, run: Runner = execFile): Promise<void> {
  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:OPENCODE_LITELLM_AUDIT_PATH",
    ], { windowsHide: true, env: { ...process.env, OPENCODE_LITELLM_AUDIT_PATH: path } })
    return
  }
  await run(process.platform === "darwin" ? "open" : "xdg-open", [path], { windowsHide: true })
}

async function pipeToClipboard(command: string, args: string[], path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
    child.on("error", reject)
    child.stdin.on("error", reject)
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error("clipboard command failed")))
    child.stdin.end(path)
  })
}

export async function copyAuditPath(path: string, run: Runner = execFile): Promise<void> {
  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-STA", "-Command",
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($env:OPENCODE_LITELLM_AUDIT_PATH)",
    ], { windowsHide: true, env: { ...process.env, OPENCODE_LITELLM_AUDIT_PATH: path } })
    return
  }
  if (process.platform === "darwin") {
    await pipeToClipboard("pbcopy", [], path)
    return
  }
  await pipeToClipboard(process.env.WAYLAND_DISPLAY ? "wl-copy" : "xclip", process.env.WAYLAND_DISPLAY ? [] : ["-selection", "clipboard"], path)
}
