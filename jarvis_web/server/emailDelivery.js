"use strict";

const nodemailer = require("nodemailer");

function mailSettings(env = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  return { configured: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM), host: env.SMTP_HOST || "", port: Number.isInteger(port) ? port : 587, secure: String(env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465, user: env.SMTP_USER || "", password: env.SMTP_PASSWORD || "", from: env.SMTP_FROM || "", baseUrl: String(env.JARVIS_PUBLIC_URL || env.CLIENT_URL || (env.NODE_ENV === "production" ? "" : "http://localhost:5173")).replace(/\/$/, "") };
}
function createEmailDelivery({ env = process.env, createTransport = nodemailer.createTransport } = {}) {
  const settings = mailSettings(env);
  return {
    configured: settings.configured && Boolean(settings.baseUrl),
    async sendAdminReset(email, token) {
      if (!this.configured) return false;
      const resetUrl = new URL("/", settings.baseUrl); resetUrl.searchParams.set("reset_token", token);
      const transport = createTransport({ host: settings.host, port: settings.port, secure: settings.secure, auth: { user: settings.user, pass: settings.password } });
      await transport.sendMail({ from: settings.from, to: email, subject: "Jarvis Admin password reset", text: `A Jarvis Admin password reset was requested. Open this one-time link within 15 minutes:\n\n${resetUrl.toString()}\n\nIf you did not request this, ignore this message.` });
      return true;
    },
  };
}
module.exports = { createEmailDelivery, mailSettings };
