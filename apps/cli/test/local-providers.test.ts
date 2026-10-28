import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";

test("doctor checks a local Kilo provider without saved API credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "jevgrep-local-provider-"));
  try {
    const bin = join(home, "bin");
    await mkdir(bin);
    const command = join(bin, "kilo");
    await writeFile(
      command,
      "#!/usr/bin/env node\n" +
        'const fs = require("node:fs");\n' +
        'const args = process.argv; const file = args[args.indexOf("--file") + 1];\n' +
        'fs.writeFileSync(process.env.JG_PROBE, JSON.stringify({args, prompt:file ? fs.readFileSync(file,"utf8") : "", config:process.env.KILO_CONFIG_CONTENT}));\n' +
        'console.log(JSON.stringify({type:"text",part:{text:"{\\\"relevant\\\":0.95}"}}));\n',
    );
    await chmod(command, 0o755);
    const probe = join(home, "invocation.txt");
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../src/index.ts"),
        "doctor",
        "--local-provider",
        "kilo",
      ],
      {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(home, "config"),
          XDG_CACHE_HOME: join(home, "cache"),
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          JG_PROBE: probe,
          KILO_CONFIG_CONTENT: '{"provider":{"local":{"name":"Existing"}}}',
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("verified through Kilo CLI");
    const invoked = JSON.parse(await readFile(probe, "utf8")) as {
      args: string[];
      prompt: string;
      config: string;
    };
    expect(invoked.args.join(" ")).not.toContain("Does this source implement recording an event?");
    expect(invoked.prompt).toContain("Does this source implement recording an event?");
    const agentName = invoked.args[invoked.args.indexOf("--agent") + 1];
    const requestFile = invoked.args[invoked.args.indexOf("--file") + 1]!;
    const config = JSON.parse(invoked.config);
    expect(config.provider.local.name).toBe("Existing");
    expect(config.agent[agentName]).toMatchObject({
      mode: "primary",
      steps: 1,
      permission: {
        "*": "deny",
        read: { "*": "deny", [`**/${basename(dirname(requestFile))}/request.txt`]: "allow" },
      },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex local provider sends the scoring request on stdin and reads its final answer", async () => {
  const home = await mkdtemp(join(tmpdir(), "jevgrep-local-codex-"));
  try {
    const bin = join(home, "bin");
    await mkdir(bin);
    const command = join(bin, "codex");
    await writeFile(
      command,
      "#!/usr/bin/env node\n" +
        'const fs = require("node:fs"); const args = process.argv;\n' +
        'let input = ""; process.stdin.on("data", chunk => input += chunk);\n' +
        'process.stdin.on("end", () => {\n' +
        '  fs.writeFileSync(args[args.indexOf("-o") + 1], "{\\\"relevant\\\":0.95}");\n' +
        "  fs.writeFileSync(process.env.JG_PROBE, JSON.stringify({args,input}));\n" +
        "});\n",
    );
    await chmod(command, 0o755);
    const probe = join(home, "invocation.json");
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../src/index.ts"),
        "doctor",
        "--local-provider",
        "codex",
      ],
      {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(home, "config"),
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          JG_PROBE: probe,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("verified through Codex CLI");
    const invoked = JSON.parse(await readFile(probe, "utf8")) as { args: string[]; input: string };
    expect(invoked.args.join(" ")).not.toContain("Does this source implement recording an event?");
    expect(invoked.input).toContain("Does this source implement recording an event?");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Claude local provider reads its signed-in CLI result without a Jev key", async () => {
  const home = await mkdtemp(join(tmpdir(), "jevgrep-local-claude-"));
  try {
    const bin = join(home, "bin");
    await mkdir(bin);
    const command = join(bin, "claude");
    await writeFile(
      command,
      "#!/usr/bin/env node\n" +
        'const fs = require("node:fs"); const args = process.argv;\n' +
        'let input = ""; process.stdin.on("data", chunk => input += chunk);\n' +
        'process.stdin.on("end", () => {\n' +
        "  fs.writeFileSync(process.env.JG_PROBE, JSON.stringify({args,input}));\n" +
        '  console.log(JSON.stringify({result:"{\\\"relevant\\\":0.95}"}));\n' +
        "});\n",
    );
    await chmod(command, 0o755);
    const probe = join(home, "invocation.json");
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../src/index.ts"),
        "doctor",
        "--local-provider",
        "claude",
      ],
      {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(home, "config"),
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          JG_PROBE: probe,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("verified through Claude Code CLI");
    const invoked = JSON.parse(await readFile(probe, "utf8")) as { args: string[]; input: string };
    expect(invoked.args.join(" ")).not.toContain("Does this source implement recording an event?");
    expect(invoked.input).toContain("Does this source implement recording an event?");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("search retrieves source through a local CLI without Jev credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "jevgrep-local-search-"));
  try {
    const bin = join(home, "bin"),
      project = join(home, "project");
    await mkdir(bin);
    await mkdir(project);
    await writeFile(
      join(project, "auth.ts"),
      "export function authorize(user: { admin: boolean }) { return user.admin; }\n",
    );
    const command = join(bin, "claude");
    await writeFile(
      command,
      "#!/usr/bin/env node\n" +
        'let input = ""; process.stdin.on("data", chunk => input += chunk);\n' +
        'process.stdin.on("end", () => {\n' +
        "  const line = input.match(/^Questions: (.+)$/m);\n" +
        "  const scores = Object.fromEntries(Object.keys(JSON.parse(line[1])).map(id => [id, 0.95]));\n" +
        "  console.log(JSON.stringify({result:JSON.stringify(scores)}));\n" +
        "});\n",
    );
    await chmod(command, 0o755);
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../src/index.ts"),
        "Where is a user authorized?",
        project,
        "--local-provider",
        "claude",
        "--max-requests",
        "20",
      ],
      {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(home, "config"),
          XDG_CACHE_HOME: join(home, "cache"),
          PATH: `${bin}${delimiter}${process.env.PATH}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("auth.ts");
    expect(stdout).toContain("export function authorize");
    expect(stdout).toContain("End context.");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
