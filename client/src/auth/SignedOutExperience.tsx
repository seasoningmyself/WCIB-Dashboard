import React, { useEffect, useState } from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import { passwordResetTokenSchema } from "../../../shared/password-reset.js";
import type { AuthApi } from "./api.js";
import { LoginScreen } from "./LoginScreen.js";
import { PasswordResetConfirmScreen } from "./PasswordResetConfirmScreen.js";
import { PasswordResetRequestScreen } from "./PasswordResetRequestScreen.js";
import {
  parseSignedOutRoute,
  sanitizedResetUrl,
  type SignedOutRoute,
} from "./signed-out-route.js";

export function SignedOutExperience({
  api,
  onAuthenticated,
}: {
  api: AuthApi;
  onAuthenticated(user: CurrentUser, authenticatedPassword: string): void;
}) {
  const [route, setRoute] = useState<SignedOutRoute>(consumeRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(consumeRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigateToLogin = () => {
    if (typeof window !== "undefined") {
      window.location.hash = "/";
    }
    setRoute({ type: "login" });
  };

  if (route.type === "reset_request") {
    return <PasswordResetRequestScreen api={api} />;
  }
  if (route.type === "reset_confirm") {
    return (
      <PasswordResetConfirmScreen
        api={api}
        onComplete={navigateToLogin}
        onTokenConsumed={() =>
          setRoute({ token: null, type: "reset_confirm" })
        }
        token={route.token}
      />
    );
  }
  return <LoginScreen api={api} onAuthenticated={onAuthenticated} />;
}

function consumeRoute(): SignedOutRoute {
  if (typeof window === "undefined") {
    return { type: "login" };
  }
  const route = parseSignedOutRoute(
    window.location.hash,
    window.location.search,
  );
  if (route.type === "reset_confirm" && route.token !== null) {
    window.history.replaceState(
      null,
      "",
      sanitizedResetUrl(window.location.pathname, window.location.search),
    );
    if (!passwordResetTokenSchema.safeParse(route.token).success) {
      return { token: null, type: "reset_confirm" };
    }
  }
  return route;
}
