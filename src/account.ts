export type AccountUser = {
  id: number;
  uid?: string;
  exportAccess?: boolean;
  studioAccess?: boolean;
  exportQuotaAllowed?: boolean;
  heldCredits?: number;
  username: string;
  role: "user" | "admin";
  email: string | null;
  emailVerified: boolean;
  signupRewardPending?: boolean;
  memberUntil: number;
  freeCredits: number;
  inviteCode: string;
  status: "admin" | "member" | "expired" | "ordinary";
};
export const accountLabel = (u: AccountUser | null) =>
  !u
    ? "游客"
    : {
        admin: "管理员",
        member: "有效会员",
        expired: "会员已到期",
        ordinary: "普通用户",
      }[u.status];
