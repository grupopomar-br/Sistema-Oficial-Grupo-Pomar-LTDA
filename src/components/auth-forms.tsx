"use client";
import { useActionState, useState } from "react";
import { ArrowRight, Shield, Loader2, KeyRound } from "lucide-react";
import { Button, Field } from "./ui";
import {
  signIn,
  requestPasswordReset,
  verifyMfa,
  enrollMfa,
  changePassword,
  type AuthState,
} from "@/app/auth-actions";
export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, {} as AuthState);
  return (
    <>
      <form action={action}>
        <Field label="E-mail do proprietário">
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            autoFocus
          />
        </Field>
        <Field label="Senha">
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            maxLength={200}
          />
        </Field>
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <ArrowRight size={16} />
          )}
          Entrar na Central
        </Button>
      </form>
      <div className="auth-links">
        <a href="/recuperar">Recuperar acesso</a>
      </div>
    </>
  );
}
export function RecoveryForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    {} as AuthState,
  );
  return (
    <>
      <form action={action}>
        <Field label="E-mail cadastrado">
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            autoFocus
          />
        </Field>
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        {state.success && (
          <div className="inline-note" role="status">
            {state.success}
          </div>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={pending || !!state.success}
        >
          {pending ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <ArrowRight size={16} />
          )}
          Solicitar recuperação
        </Button>
      </form>
      <div className="auth-links">
        <a href="/entrar">Voltar para entrar</a>
      </div>
    </>
  );
}
export function PasswordForm() {
  const [state, action, pending] = useActionState(
    changePassword,
    {} as AuthState,
  );
  return (
    <form action={action}>
      <Field label="Nova senha">
        <input
          type="password"
          name="password"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          required
          autoFocus
        />
      </Field>
      <Field label="Confirme a nova senha">
        <input
          type="password"
          name="confirmation"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          required
        />
      </Field>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? (
          <Loader2 className="spin" size={16} />
        ) : (
          <KeyRound size={16} />
        )}
        Atualizar senha e sair
      </Button>
    </form>
  );
}
export function MfaForm({
  factors,
  next,
}: {
  factors: { id: string; name: string }[];
  next: string;
}) {
  const [state, action, pending] = useActionState(verifyMfa, {} as AuthState);
  const [enrollment, setEnrollment] = useState<{
    factorId?: string;
    qrCode?: string;
    secret?: string;
    error?: string;
  } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const begin = async () => {
    setEnrolling(true);
    try {
      setEnrollment(await enrollMfa());
    } finally {
      setEnrolling(false);
    }
  };
  const qr = enrollment?.qrCode;
  const qrSrc = qr
    ? qr.startsWith("data:image/")
      ? qr
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`
    : null;
  return (
    <>
      {!factors.length && !enrollment?.factorId && (
        <Button
          variant="primary"
          onClick={() => void begin()}
          disabled={enrolling}
        >
          {enrolling ? (
            <Loader2 size={17} className="spin" />
          ) : (
            <Shield size={17} />
          )}
          Configurar meu autenticador
        </Button>
      )}
      {enrollment?.error && (
        <p className="form-error" role="alert">
          {enrollment.error}
        </p>
      )}
      {qrSrc && (
        <>
          <img
            className="qr-code"
            src={qrSrc}
            alt="QR Code para configurar seu aplicativo autenticador"
            width={200}
            height={200}
          />
          <p className="helper-text">
            Leia o QR Code com seu aplicativo autenticador. Se necessário,
            utilize a chave abaixo:
          </p>
          <p className="totp-secret">{enrollment?.secret}</p>
        </>
      )}
      {(factors.length > 0 || enrollment?.factorId) && (
        <form action={action}>
          <input type="hidden" name="next" value={next} />
          {factors.length > 1 ? (
            <Field label="Autenticador">
              <select name="factorId">
                {factors.map((factor) => (
                  <option key={factor.id} value={factor.id}>
                    {factor.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <input
              type="hidden"
              name="factorId"
              value={enrollment?.factorId ?? factors[0]?.id}
            />
          )}
          <Field label="Código de seis dígitos">
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              autoComplete="one-time-code"
              required
              autoFocus
            />
          </Field>
          {state.error && (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Shield size={16} />
            )}
            Verificar e continuar
          </Button>
        </form>
      )}
      <div className="auth-links">
        <a href="/entrar">Voltar ao acesso</a>
      </div>
    </>
  );
}
