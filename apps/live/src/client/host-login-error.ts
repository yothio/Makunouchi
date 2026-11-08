export type HostLoginErrorKind = "invalid_credentials" | "unsupported" | "locked" | "network";

export type HostLoginFailure = { kind: "http"; status: number } | { kind: "network" };

export const classifyHostLoginError = (failure: HostLoginFailure): HostLoginErrorKind => {
  if (failure.kind === "network") return "network";
  switch (failure.status) {
    case 401:
      return "invalid_credentials";
    case 404:
      return "unsupported";
    case 429:
      return "locked";
    default:
      return "network";
  }
};
