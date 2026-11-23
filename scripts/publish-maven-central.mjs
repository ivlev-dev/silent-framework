import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const kotlin = join(root, "kotlin");
const username = process.env.MAVEN_CENTRAL_USERNAME;
const password = process.env.MAVEN_CENTRAL_PASSWORD;
const key = process.env.GPG_PRIVATE_KEY;
const passphrase = process.env.GPG_PASSPHRASE ?? "";

if (username === undefined || password === undefined || key === undefined) {
  console.error("publish-maven-central: задайте MAVEN_CENTRAL_USERNAME, MAVEN_CENTRAL_PASSWORD и GPG_PRIVATE_KEY");
  process.exit(2);
}

const properties = readFileSync(join(kotlin, "gradle.properties"), "utf8");
const version = /^protocolVersion=(.+)$/m.exec(properties)?.[1]?.trim();
if (version === undefined) {
  console.error("publish-maven-central: protocolVersion не найден в kotlin/gradle.properties");
  process.exit(2);
}

const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, GPG_PRIVATE_KEY: key, GPG_PASSPHRASE: passphrase },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run("gradle", [
  ":protocol:publishMavenPublicationToStagingRepository",
  ":ksp-processor:publishMavenPublicationToStagingRepository",
  "--console=plain",
], kotlin);

const staging = join(kotlin, "build", "staging-repo");
if (!existsSync(staging)) {
  console.error("publish-maven-central: staging-repo не создан");
  process.exit(1);
}

const temporary = mkdtempSync(join(tmpdir(), "silent-maven-"));
const bundle = join(temporary, `silent-protocol-${version}.zip`);
try {
  run("zip", ["-qr", bundle, "."], staging);
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  const form = new FormData();
  form.append("bundle", new Blob([readFileSync(bundle)], { type: "application/octet-stream" }), `silent-protocol-${version}.zip`);
  const upload = await fetch(
    `https://central.sonatype.com/api/v1/publisher/upload?name=silent-protocol-${version}&publishingType=AUTOMATIC`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
  );
  const id = (await upload.text()).trim();
  if (!upload.ok || id.length === 0) {
    console.error(`publish-maven-central: upload ${String(upload.status)}: ${id}`);
    process.exit(1);
  }
  console.log(`publish-maven-central: deployment ${id}`);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await fetch(
      `https://central.sonatype.com/api/v1/publisher/status?id=${encodeURIComponent(id)}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    const payload = await status.json();
    console.log(`publish-maven-central: ${String(payload.deploymentState)}`);
    if (payload.deploymentState === "PUBLISHED") {
      process.exit(0);
    }
    if (payload.deploymentState === "FAILED" || payload.deploymentState === "VALIDATION_FAILED") {
      console.error(JSON.stringify(payload.errors ?? payload, null, 2));
      process.exit(1);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 15000));
  }
  console.error("publish-maven-central: истекло время ожидания");
  process.exit(1);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
