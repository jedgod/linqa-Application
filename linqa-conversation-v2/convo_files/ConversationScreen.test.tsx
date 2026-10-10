import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";
import { ConversationScreen } from "./ConversationScreen";
import { ConversationServiceLike, MessagingGateLike, MessagingMode, ServerRow } from "./types";

const rows: ServerRow[] = [
  { id: "m1", senderId: "jerry", sentAt: "2026-10-06T14:00:00Z", ciphertext: "c1" },
  { id: "m2", senderId: "me", sentAt: "2026-10-06T14:01:00Z", ciphertext: "c2" },
  { id: "m3", senderId: "jerry", sentAt: "2026-10-06T14:02:00Z", ciphertext: "c3" },
];

function makeService(overrides: Partial<ConversationServiceLike> = {}): ConversationServiceLike {
  return {
    loadHistory: jest.fn().mockResolvedValue({ rows }),
    decryptServerRows: jest.fn().mockImplementation(async (_id, rs: ServerRow[]) =>
      rs.map((r) => ({ id: r.id, ok: true as const, text: `plain ${r.id}` }))
    ),
    send: jest.fn().mockResolvedValue({ id: "m4", senderId: "me", sentAt: "2026-10-06T14:03:00Z", ciphertext: "c4" }),
    markRead: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const gateOf = (m: MessagingMode | Error): MessagingGateLike => ({
  evaluate: m instanceof Error ? jest.fn().mockRejectedValue(m) : jest.fn().mockResolvedValue(m),
});

function setup(gate: MessagingGateLike, service = makeService()) {
  render(
    <ConversationScreen
      conversationId="c-jerry"
      selfId="me"
      peer={{ id: "jerry", displayName: "Jerry Mensah" }}
      service={service}
      gate={gate}
      onBack={jest.fn()}
      onOpenSettings={jest.fn()}
    />
  );
  return service;
}

describe("ConversationScreen fail-closed", () => {
  it("LOCKED: no composer, every body sealed, decrypt never called", async () => {
    const service = setup(gateOf({ mode: "LOCKED", reason: "SECURE_CORE_UNAVAILABLE" }));
    await waitFor(() => expect(screen.getAllByText("Encrypted message")).toHaveLength(3));
    expect(screen.queryByTestId("composer-input")).toBeNull();
    expect(screen.getByText("Messages are sealed on this device", { exact: false })).toBeTruthy();
    expect(service.decryptServerRows).not.toHaveBeenCalled();
    expect(screen.queryByText(/plain /)).toBeNull();
  });

  it("gate throwing is treated as LOCKED", async () => {
    setup(gateOf(new Error("boom")));
    await waitFor(() => expect(screen.getByText("Encryption check failed")).toBeTruthy());
    expect(screen.queryByTestId("composer-input")).toBeNull();
  });

  it("LIVE: decrypts history and enables the composer", async () => {
    setup(gateOf({ mode: "LIVE" }));
    await waitFor(() => expect(screen.getByText("plain m3")).toBeTruthy());
    expect(screen.getByTestId("composer-input")).toBeTruthy();
  });

  it("one bad row stays unreadable without locking the thread", async () => {
    const service = makeService({
      decryptServerRows: jest.fn().mockImplementation(async (_id, rs: ServerRow[]) =>
        rs.map((r) => (r.id === "m1" ? { id: r.id, ok: false as const } : { id: r.id, ok: true as const, text: `plain ${r.id}` }))
      ),
    });
    setup(gateOf({ mode: "LIVE" }), service);
    await waitFor(() => expect(screen.getByText("Can't open this message")).toBeTruthy());
    expect(screen.getByText("plain m3")).toBeTruthy();
    expect(screen.getByTestId("composer-input")).toBeTruthy();
  });

  it("send failing with SECURE_CORE_UNAVAILABLE re-checks the gate", async () => {
    const gate: MessagingGateLike = {
      evaluate: jest
        .fn()
        .mockResolvedValueOnce({ mode: "LIVE" })
        .mockResolvedValue({ mode: "LOCKED", reason: "SECURE_CORE_UNAVAILABLE" }),
    };
    const err = Object.assign(new Error("no core"), { code: "SECURE_CORE_UNAVAILABLE" });
    setup(gate, makeService({ send: jest.fn().mockRejectedValue(err) }));

    await waitFor(() => expect(screen.getByTestId("composer-input")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("composer-input"), "hello");
    fireEvent.press(screen.getByTestId("composer-send"));

    await waitFor(() => expect(screen.queryByTestId("composer-input")).toBeNull());
    expect(screen.queryByText("hello")).toBeNull();
    expect(screen.queryByText(/plain /)).toBeNull();
  });
});
