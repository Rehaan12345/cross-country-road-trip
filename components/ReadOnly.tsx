"use client";

import { createContext, useContext } from "react";

/**
 * Whether this session may change anything. Resolved on the server in the root
 * layout and handed down, so the first paint is already correct — a viewer
 * never sees a live Stop button flash before the client works out who they are.
 *
 * This is presentation only. The enforcement is the method check in
 * middleware.ts; hiding a button has never stopped anyone from sending a POST.
 */
const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return (
    <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>
  );
}

export function useReadOnly() {
  return useContext(ReadOnlyContext);
}
