"use client";

import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { ErrorBanner, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";

type Mode = "login" | "register";

const inputClass =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm focus:border-primary";

export function AuthForm({ mode }: { mode: Mode }) {
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, fullName);
      // The (auth) layout redirects to /dashboard once status flips to authenticated.
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && mode === "register") {
        setFieldErrors({
          email: err.fieldErrors("email"),
          password: [...err.fieldErrors("password"), ...err.fieldErrors("non_field_errors")],
          full_name: err.fieldErrors("full_name"),
        });
      } else if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect email or password.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <h2 className="text-lg font-medium">{mode === "login" ? "Log in" : "Create an account"}</h2>
      <ErrorBanner message={error} />

      {mode === "register" && (
        <Field label="Full name" errors={fieldErrors.full_name}>
          <input
            className={inputClass}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
        </Field>
      )}

      <Field label="Email" errors={fieldErrors.email}>
        <input
          className={inputClass}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </Field>

      <Field label="Password" errors={fieldErrors.password}>
        <input
          className={inputClass}
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </Field>

      <button
        type="submit"
        disabled={submitting || !email || !password}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting && <Spinner className="h-4 w-4 border-primary-fg/40 border-t-primary-fg" />}
        {mode === "login" ? "Log in" : "Sign up"}
      </button>

      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            No account?{" "}
            <Link href="/register" className="font-medium text-primary-strong underline hover:text-primary">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary-strong underline hover:text-primary">
              Log in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  label,
  errors,
  children,
}: {
  label: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-fg-soft">{label}</span>
      {children}
      {errors?.map((msg) => (
        <span key={msg} className="block text-xs text-danger">
          {msg}
        </span>
      ))}
    </label>
  );
}
