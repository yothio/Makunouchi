export type HostGateState = { token: string };

export type HostGateEvent = { type: "login_success"; token: string } | { type: "discard_token" };

export type HostGateScreen = "HostLogin" | "HostApp";

export const initialHostGateState = (token: string): HostGateState => ({ token });

export const screenForHostGate = (state: HostGateState): HostGateScreen => {
  return state.token ? "HostApp" : "HostLogin";
};

export const applyHostGateEvent = (state: HostGateState, event: HostGateEvent): HostGateState => {
  switch (event.type) {
    case "login_success":
      return { token: event.token };
    case "discard_token":
      return { token: "" };
  }
};
