import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CpeHttpRequest, CpeHttpResponse, CpeHttpTransport } from "../types/http";
import { HuaweiAuthMachine, computeHuaweiClientProof } from "./huawei-auth";
import { parseHuaweiXml } from "../xml/parser";

function fixture(name: string): string {
  return readFileSync(new URL(`../../../../fixtures/h168/${name}`, import.meta.url), "utf8");
}

function response(body: string, status = 200): CpeHttpResponse {
  return { status, headers: {}, body, durationMs: 1 };
}

class FakeHuaweiTransport implements CpeHttpTransport {
  readonly requests: CpeHttpRequest[] = [];
  sessionTokenCalls = 0;
  challengeCalls = 0;
  signalCalls = 0;
  alwaysFailSignal = false;

  async request(request: CpeHttpRequest): Promise<CpeHttpResponse> {
    this.requests.push(request);
    if (request.path === "/html/content.html" || request.path === "/api/user/state-login") {
      return response("<response><State>0</State></response>");
    }
    if (request.path === "/api/webserver/SesTokInfo") {
      this.sessionTokenCalls += 1;
      return {
        ...response(fixture(this.sessionTokenCalls % 2 === 0 ? "ses-tok-info-2.xml" : "ses-tok-info.xml")),
        headers: { "Set-Cookie": "SessionID=fixture-session-1; Path=/" },
      };
    }
    if (request.path === "/api/user/challenge_login") {
      this.challengeCalls += 1;
      return response(fixture("challenge.xml"));
    }
    if (request.path === "/api/user/authentication_login") {
      return response(fixture("authentication.xml"));
    }
    if (request.path === "/api/device/signal") {
      this.signalCalls += 1;
      if (this.alwaysFailSignal || this.signalCalls === 1) {
        return response(fixture("error-125003.xml"));
      }
      return response(fixture("signal.xml"));
    }
    return response("<response><ok>1</ok></response>");
  }
}

describe("Huawei authentication state machine", () => {
  it("uses SessionID plus separate tokens for challenge and authentication", async () => {
    const transport = new FakeHuaweiTransport();
    const machine = new HuaweiAuthMachine(transport, {
      username: "fixture-user",
      password: "fixture-password",
      nonceFactory: () => "fixture-first-nonce",
    });

    const result = await machine.login();
    const challenge = transport.requests.find((item) => item.path === "/api/user/challenge_login");
    const authentication = transport.requests.find((item) => item.path === "/api/user/authentication_login");

    expect(machine.state).toBe("authenticated");
    expect(result.sessionId).toBe("fixture-session-1");
    expect(result.csrfToken).toBe("fixture-token-2");
    expect(challenge?.headers["__RequestVerificationToken"]).toBe("fixture-token-1");
    expect(authentication?.headers["__RequestVerificationToken"]).toBe("fixture-token-2");
    expect(challenge?.headers.Cookie).toContain("SessionID=fixture-session-1");
    expect(authentication?.headers.Cookie).toContain("SessionID=fixture-session-1");
    expect(challenge?.body).toContain("fixture-user");
    expect(challenge?.body).not.toContain("fixture-password");
    expect(machine.trace.every((item) => item.path !== "/api/user/login")).toBe(true);
  });

  it("computes a fixed-size proof without exposing the password", async () => {
    const proof = await computeHuaweiClientProof(
      "fixture-password",
      "fixture-first-nonce",
      "00112233445566778899aabbccddeeff",
      2,
      "fixture-server-nonce",
    );

    expect(proof).toBe("4bf9e10519eeaf39ef850ca4070fd4896b939235c3833f26d45551fbde7b7cc8");
  });

  it("reauthenticates exactly once after 125003", async () => {
    const transport = new FakeHuaweiTransport();
    const machine = new HuaweiAuthMachine(transport, {
      username: "fixture-user",
      password: "fixture-password",
      nonceFactory: () => "fixture-first-nonce",
    });

    const result = await machine.requestWithSession({
      method: "GET",
      path: "/api/device/signal",
      headers: {},
      body: null,
    });

    expect(result.status).toBe(200);
    expect(transport.signalCalls).toBe(2);
    expect(transport.challengeCalls).toBe(2);
    expect(transport.sessionTokenCalls).toBe(4);
  });

  it("does not enter a reauthentication loop when the refreshed request fails", async () => {
    const transport = new FakeHuaweiTransport();
    transport.alwaysFailSignal = true;
    const machine = new HuaweiAuthMachine(transport, {
      username: "fixture-user",
      password: "fixture-password",
      nonceFactory: () => "fixture-first-nonce",
    });

    const result = await machine.requestWithSession({
      method: "GET",
      path: "/api/device/signal",
      headers: {},
      body: null,
    });

    expect(result.status).toBe(200);
    expect(parseHuaweiXml(result.body).error?.code).toBe(125003);
    expect(machine.state).toBe("authenticated");
    expect(transport.signalCalls).toBe(2);
    expect(transport.challengeCalls).toBe(2);
  });
});
