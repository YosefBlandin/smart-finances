import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  SignUpCommand,
  VerifySoftwareTokenCommand,
  type AdminGetUserCommandOutput,
  type AssociateSoftwareTokenCommandOutput,
  type AuthenticationResultType,
  type InitiateAuthCommandOutput,
  type RespondToAuthChallengeCommandOutput,
  type VerifySoftwareTokenCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import { createHmac } from 'node:crypto';
import type { Fail } from '@/domain/result';
import type { Clock } from '@/ports/clock';
import type { IdentityFailure, IdentityProvider, Lang, Tokens } from '@/ports/identity-provider';
import type { SecretStore } from '@/ports/secret-store';

type AnyCommand =
  | AdminDeleteUserCommand
  | AdminGetUserCommand
  | AdminUserGlobalSignOutCommand
  | AssociateSoftwareTokenCommand
  | ConfirmForgotPasswordCommand
  | ConfirmSignUpCommand
  | ForgotPasswordCommand
  | InitiateAuthCommand
  | ResendConfirmationCodeCommand
  | RespondToAuthChallengeCommand
  | RevokeTokenCommand
  | SignUpCommand
  | VerifySoftwareTokenCommand;

/** The calls this adapter makes; tests pass a hand-written fake. */
export type CognitoClient = { send(command: AnyCommand): Promise<object> };

/** base64(HMAC-SHA256(client secret, username + client id)), the SECRET_HASH of a confidential client (D-73). */
export function secretHash(secret: string, username: string, clientId: string): string {
  return createHmac('sha256', secret)
    .update(username + clientId)
    .digest('base64');
}

// The login is the lower-cased email (the pool's sign-in is case-insensitive, and the hash must match).
const login = (email: string) => email.trim().toLowerCase();
const fail = (reason: IdentityFailure): Fail<IdentityFailure> => ({ ok: false, reason });
const ok = { ok: true as const };

// Service errors by name; anything not listed is 'failed'. The SDK's message is never passed on (it can hold the email).
type ErrorMap = Partial<Record<string, IdentityFailure>>;
const LIMITED: ErrorMap = { TooManyRequestsException: 'limited', LimitExceededException: 'limited', TooManyFailedAttemptsException: 'limited' };
const CODE: ErrorMap = { CodeMismatchException: 'bad_code', ExpiredCodeException: 'expired_code', ...LIMITED };

class Refusal extends Error {
  constructor(readonly reason: IdentityFailure) {
    super(reason);
  }
}

// Sign-up, confirm, sign-in, setup, reset, refresh and the admin calls on this pool with the web server's confidential
// client (D-73): every client call carries the secret hash; the secret is read at run time from Secrets Manager by
// its ARN (never a setting). No context data is sent (D-117). Expected failures come back as reasons, never throws.
export class CognitoIdentityProvider implements IdentityProvider {
  private readonly client: CognitoClient;
  private readonly userPoolId: string;
  private readonly clientId: string;
  private readonly clientSecretArn: string;
  private readonly secretStore: SecretStore;
  private readonly clock: Clock;

  constructor(opts: {
    client?: CognitoClient;
    region?: string;
    userPoolId: string;
    clientId: string;
    clientSecretArn: string;
    secretStore: SecretStore;
    clock: Clock;
  }) {
    this.client = opts.client ?? new CognitoIdentityProviderClient({ region: opts.region });
    this.userPoolId = opts.userPoolId;
    this.clientId = opts.clientId;
    this.clientSecretArn = opts.clientSecretArn;
    this.secretStore = opts.secretStore;
    this.clock = opts.clock;
  }

  private async secret(): Promise<string> {
    try {
      return await this.secretStore.get(this.clientSecretArn);
    } catch {
      throw new Refusal('failed');
    }
  }

  private async hash(username: string) {
    return secretHash(await this.secret(), username, this.clientId);
  }

  private async send<O>(command: AnyCommand, errors: ErrorMap): Promise<O> {
    try {
      return (await this.client.send(command)) as O;
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      throw new Refusal(errors[name] ?? LIMITED[name] ?? 'failed');
    }
  }

  // Runs one call; a Refusal (or anything unexpected) becomes { ok: false, reason }.
  private async run<T extends object>(fn: () => Promise<T | Fail<IdentityFailure>>) {
    try {
      return await fn();
    } catch (e) {
      return fail(e instanceof Refusal ? e.reason : 'failed');
    }
  }

  private tokens(result: AuthenticationResultType | undefined, keepRefresh?: string): Tokens | undefined {
    const refresh = result?.RefreshToken ?? keepRefresh;
    if (!result?.AccessToken || !result.IdToken || !refresh || !result.ExpiresIn) return undefined;
    return { access: result.AccessToken, id: result.IdToken, refresh, expiresAt: this.clock.now() + result.ExpiresIn * 1000 };
  }

  signUp(email: string, password: string, lang: Lang) {
    return this.run(async () => {
      const username = login(email);
      await this.send(
        new SignUpCommand({
          ClientId: this.clientId,
          SecretHash: await this.hash(username),
          Username: username,
          Password: password,
          UserAttributes: [{ Name: 'email', Value: username }],
          ClientMetadata: { lang },
        }),
        { UsernameExistsException: 'exists', InvalidPasswordException: 'bad_password', UserLambdaValidationException: 'refused' },
      );
      return ok;
    });
  }

  confirm(email: string, code: string) {
    return this.run(async () => {
      const username = login(email);
      await this.send(
        new ConfirmSignUpCommand({ ClientId: this.clientId, SecretHash: await this.hash(username), Username: username, ConfirmationCode: code }),
        { ...CODE, UserNotFoundException: 'not_found' },
      );
      return ok;
    });
  }

  resend(email: string, lang: Lang) {
    return this.run(async () => {
      const username = login(email);
      await this.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.clientId,
          SecretHash: await this.hash(username),
          Username: username,
          ClientMetadata: { lang },
        }),
        { UserNotFoundException: 'not_found' },
      );
      return ok;
    });
  }

  passwordAuth(email: string, password: string) {
    return this.run(async () => {
      const username = login(email);
      const out = await this.send<InitiateAuthCommandOutput>(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: this.clientId,
          AuthParameters: { USERNAME: username, PASSWORD: password, SECRET_HASH: await this.hash(username) },
        }),
        {
          NotAuthorizedException: 'bad_credentials',
          UserNotFoundException: 'bad_credentials',
          PasswordResetRequiredException: 'bad_credentials',
          UserNotConfirmedException: 'unconfirmed',
        },
      );
      if ((out.ChallengeName === 'MFA_SETUP' || out.ChallengeName === 'SOFTWARE_TOKEN_MFA') && out.Session) {
        return { ok: true as const, challenge: out.ChallengeName, session: out.Session };
      }
      const tokens = this.tokens(out.AuthenticationResult);
      return tokens ? { ok: true as const, tokens } : fail('failed');
    });
  }

  associate(session: string) {
    return this.run(async () => {
      const out = await this.send<AssociateSoftwareTokenCommandOutput>(new AssociateSoftwareTokenCommand({ Session: session }), {
        NotAuthorizedException: 'bad_session',
      });
      if (!out.SecretCode || !out.Session) return fail('failed');
      return { ok: true as const, secret: out.SecretCode, session: out.Session };
    });
  }

  verifySetup(email: string, session: string, code: string) {
    return this.run(async () => {
      const verified = await this.send<VerifySoftwareTokenCommandOutput>(
        new VerifySoftwareTokenCommand({ Session: session, UserCode: code, FriendlyDeviceName: 'Cuenta' }),
        { ...CODE, EnableSoftwareTokenMFAException: 'bad_code', NotAuthorizedException: 'bad_session' },
      );
      if (verified.Status !== 'SUCCESS' || !verified.Session) return fail('bad_code');
      const username = login(email);
      const out = await this.send<RespondToAuthChallengeCommandOutput>(
        new RespondToAuthChallengeCommand({
          ClientId: this.clientId,
          ChallengeName: 'MFA_SETUP',
          Session: verified.Session,
          ChallengeResponses: { USERNAME: username, SECRET_HASH: await this.hash(username) },
        }),
        { NotAuthorizedException: 'bad_session' },
      );
      const tokens = this.tokens(out.AuthenticationResult);
      return tokens ? { ok: true as const, tokens } : fail('failed');
    });
  }

  respondCode(email: string, session: string, code: string) {
    return this.run(async () => {
      const username = login(email);
      const out = await this.send<RespondToAuthChallengeCommandOutput>(
        new RespondToAuthChallengeCommand({
          ClientId: this.clientId,
          ChallengeName: 'SOFTWARE_TOKEN_MFA',
          Session: session,
          ChallengeResponses: { USERNAME: username, SOFTWARE_TOKEN_MFA_CODE: code, SECRET_HASH: await this.hash(username) },
        }),
        { ...CODE, NotAuthorizedException: 'bad_session' },
      );
      const tokens = this.tokens(out.AuthenticationResult);
      return tokens ? { ok: true as const, tokens } : fail('failed');
    });
  }

  forgot(email: string, lang: Lang) {
    return this.run(async () => {
      const username = login(email);
      await this.send(
        new ForgotPasswordCommand({ ClientId: this.clientId, SecretHash: await this.hash(username), Username: username, ClientMetadata: { lang } }),
        { UserNotFoundException: 'not_found' },
      );
      return ok;
    });
  }

  confirmForgot(email: string, code: string, password: string) {
    return this.run(async () => {
      const username = login(email);
      await this.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          SecretHash: await this.hash(username),
          Username: username,
          ConfirmationCode: code,
          Password: password,
        }),
        { ...CODE, InvalidPasswordException: 'bad_password', UserNotFoundException: 'bad_code' },
      );
      return ok;
    });
  }

  // The refresh secret hash uses the sub, the pool's username (Contracts "Ports"); without rotation no new refresh
  // token comes back, so the current one is kept.
  refresh(sub: string, refreshToken: string) {
    return this.run(async () => {
      const out = await this.send<InitiateAuthCommandOutput>(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: this.clientId,
          AuthParameters: { REFRESH_TOKEN: refreshToken, SECRET_HASH: await this.hash(sub) },
        }),
        { NotAuthorizedException: 'revoked', UserNotFoundException: 'revoked' },
      );
      const tokens = this.tokens(out.AuthenticationResult, refreshToken);
      return tokens ? { ok: true as const, tokens } : fail('failed');
    });
  }

  revoke(refreshToken: string) {
    return this.run(async () => {
      await this.send(new RevokeTokenCommand({ Token: refreshToken, ClientId: this.clientId, ClientSecret: await this.secret() }), {});
      return ok;
    });
  }

  adminGet(email: string) {
    return this.run(async () => {
      const out = await this.send<AdminGetUserCommandOutput>(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: login(email) }), {
        UserNotFoundException: 'not_found',
      });
      const sub = out.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? out.Username;
      if (!sub || !out.UserStatus) return fail('failed');
      return { ok: true as const, sub, status: out.UserStatus };
    });
  }

  adminDelete(sub: string) {
    return this.run(async () => {
      await this.send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: sub }), { UserNotFoundException: 'not_found' });
      return ok;
    });
  }

  adminGlobalSignOut(sub: string) {
    return this.run(async () => {
      await this.send(new AdminUserGlobalSignOutCommand({ UserPoolId: this.userPoolId, Username: sub }), { UserNotFoundException: 'not_found' });
      return ok;
    });
  }
}
