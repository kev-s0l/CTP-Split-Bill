// The SMS seam: stand-in by default, guarded in production, Twilio when configured.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSms } from "../src/sms";

const env = { ...process.env };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "ALLOW_DEV_SMS"]) delete process.env[key];
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...env };
});

const twilio = (from = "+18005550100") => {
  process.env.TWILIO_ACCOUNT_SID = "AC123";
  process.env.TWILIO_AUTH_TOKEN = "secret";
  process.env.TWILIO_FROM = from;
};

describe("sendSms", () => {
  it("logs instead of sending when Twilio is not configured", async () => {
    await sendSms("+12125550123", "hi");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the stand-in in production unless ALLOW_DEV_SMS is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(sendSms("+12125550123", "hi")).rejects.toThrow(/stand-in is disabled/);
    process.env.ALLOW_DEV_SMS = "1";
    await expect(sendSms("+12125550123", "hi")).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("posts a form-encoded message with basic auth from a sender number", async () => {
    twilio();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    await sendSms("+12125550123", "Your code is 123456");
    const [url, init] = fetchMock.mock.lastCall!;
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    expect(Object.fromEntries(init.body)).toEqual({ To: "+12125550123", Body: "Your code is 123456", From: "+18005550100" });
  });

  it("sends through a Messaging Service when TWILIO_FROM is an MG SID", async () => {
    twilio("MG999");
    fetchMock.mockResolvedValue(new Response("{}", { status: 201 }));
    await sendSms("+12125550123", "hi");
    expect(Object.fromEntries(fetchMock.mock.lastCall![1].body)).toMatchObject({ MessagingServiceSid: "MG999" });
  });

  it("throws on Twilio errors and on incomplete configuration", async () => {
    twilio();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 21608, message: "unverified" }), { status: 400 }));
    await expect(sendSms("+12125550123", "hi")).rejects.toThrow("SMS send failed: 400 21608 unverified");
    delete process.env.TWILIO_FROM;
    await expect(sendSms("+12125550123", "hi")).rejects.toThrow(/TWILIO_FROM are required/);
  });
});
