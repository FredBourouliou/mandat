'use client';

const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

interface Stored { id: string; publicKey: string; alg: number }
const KEY = 'mandat-passkey';
// Per-browser convenience only: losing it just means creating a new passkey.
const load = (): Stored | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const save = (s: Stored | null) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

export const passkeysAvailable = () => typeof window !== 'undefined' && window.isSecureContext && 'PublicKeyCredential' in window;

/** Creates this browser's demo passkey once. Its public key comes from the browser (no attestation). */
async function register(): Promise<Stored> {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Mandat (sandbox demo)' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Mandat demo buyer', displayName: 'Mandat demo buyer' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 120_000,
    },
  }) as PublicKeyCredential | null;
  const res = cred?.response as AuthenticatorAttestationResponse | undefined;
  const spki = res?.getPublicKey?.();
  if (!cred || !res || !spki) throw new Error('This browser did not return the passkey public key.');
  const stored = { id: b64u(cred.rawId), publicKey: b64u(spki), alg: res.getPublicKeyAlgorithm() };
  save(stored);
  return stored;
}

/** Signs the mandate: the WebAuthn challenge is the mandate hash, so the assertion covers exactly this mandate. */
export async function signMandate(challenge: string) {
  const key = load() ?? await register();
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge),
      allowCredentials: [{ type: 'public-key', id: fromB64u(key.id) }],
      userVerification: 'required',
      timeout: 120_000,
    },
  }) as PublicKeyCredential | null;
  const res = cred?.response as AuthenticatorAssertionResponse | undefined;
  if (!res) throw new Error('No signature returned.');
  return {
    credentialId: key.id, publicKey: key.publicKey, alg: key.alg,
    authenticatorData: b64u(res.authenticatorData), clientDataJSON: b64u(res.clientDataJSON), signature: b64u(res.signature),
  };
}

/** Signs one order with the passkey that signed the mandate, on this device or synced to it. */
export async function signOrder(challenge: string, credentialId: string) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge),
      allowCredentials: [{ type: 'public-key', id: fromB64u(credentialId) }],
      userVerification: 'required',
      timeout: 120_000,
    },
  }) as PublicKeyCredential | null;
  const res = cred?.response as AuthenticatorAssertionResponse | undefined;
  if (!res) throw new Error('No signature returned.');
  return { authenticatorData: b64u(res.authenticatorData), clientDataJSON: b64u(res.clientDataJSON), signature: b64u(res.signature) };
}

export const hasStoredPasskey = () => load() !== null;
/** A cancelled prompt and a passkey deleted from the device look the same to the page, so only the user resets it. */
export const forgetPasskey = () => save(null);
