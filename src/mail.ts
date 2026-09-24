import nodemailer from "nodemailer";

export interface Mailer {
  /** Resolves true when the mail was handed to the SMTP server. Never throws. */
  send(to: string, subject: string, text: string): Promise<boolean>;
}

export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer {
  if (!env.SMTP_HOST) {
    return {
      async send() {
        console.info("[mail] SMTP_HOST not set, notification skipped");
        return false;
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 587),
    secure: Number(env.SMTP_PORT) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    async send(to, subject, text) {
      try {
        await transport.sendMail({ from: env.MAIL_FROM ?? env.SMTP_USER, to, subject, text });
        return true;
      } catch (e) {
        console.error("[mail] send failed:", (e as Error).message);
        return false;
      }
    },
  };
}
