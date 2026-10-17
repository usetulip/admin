import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  fetchOptions: {
    credentials: "include",
  },
  sessionOptions: {
    // Don't refetch the session every time the browser tab regains focus.
    // Default is true, which makes the dashboard re-render/flash on each tab switch.
    refetchOnWindowFocus: false,
  },
  plugins: [adminClient()],
});
