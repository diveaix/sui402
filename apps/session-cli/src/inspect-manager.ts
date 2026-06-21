import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Sui402SessionManagerClient } from "@sui402/client";
import { optionalEnv } from "./env.js";

const execFileAsync = promisify(execFile);

const managerUrl = optionalEnv("SUI402_SESSION_MANAGER_URL") ?? "http://localhost:4020/sui402";
const owner = optionalEnv("SUI402_PAYER_ADDRESS") ?? (await getActiveAddress());
const amount = optionalEnv("SUI402_PRICE") ?? optionalEnv("SUI402_SPEND_AMOUNT") ?? "1000000";
const manager = new Sui402SessionManagerClient({ baseUrl: managerUrl });

const config = await manager.getConfig();
const sessions = await manager.listSessions(owner, {
  coinType: optionalEnv("SUI402_COIN_TYPE"),
  limit: Number(optionalEnv("SUI402_SESSION_LIST_LIMIT") ?? 50)
});
const usable = await manager.findUsableSession(owner, {
  amount,
  coinType: optionalEnv("SUI402_COIN_TYPE")
});

console.log(
  JSON.stringify(
    {
      managerUrl,
      owner,
      amount,
      config,
      sessionCount: sessions.sessions.length,
      sessions: sessions.sessions,
      usable
    },
    null,
    2
  )
);

async function getActiveAddress(): Promise<string> {
  const { stdout } = await execFileAsync("sui", ["client", "active-address"], {
    env: {
      ...process.env,
      PATH: `${process.env.PATH};${process.env.LOCALAPPDATA}\\bin`
    }
  });

  return stdout.trim();
}
