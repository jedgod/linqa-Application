import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * Reads the signed-in user's id from the JWT payload your JwtAuthGuard puts on req.user.
 * Checks the common claim names; adjust if your payload uses something else.
 */
export const CurrentUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ user?: Record<string, unknown> }>();
  const id = req.user?.sub ?? req.user?.userId ?? req.user?.id;
  if (typeof id !== 'string' || !id) throw new UnauthorizedException();
  return id;
});
