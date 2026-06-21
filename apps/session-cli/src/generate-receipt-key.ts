import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
const signerId = process.env.SUI402_RECEIPT_SIGNER_ID ?? process.env.SUI402_MERCHANT_ADDRESS ?? "receipt-key-1";

console.log(
  JSON.stringify(
    {
      signerId,
      privateKeyPemBase64: Buffer.from(privatePem, "utf8").toString("base64"),
      publicKeyPemBase64: Buffer.from(publicPem, "utf8").toString("base64"),
      env: {
        SUI402_RECEIPT_SIGNER_ID: signerId,
        SUI402_RECEIPT_PRIVATE_KEY_PEM_BASE64: Buffer.from(privatePem, "utf8").toString("base64")
      }
    },
    null,
    2
  )
);
