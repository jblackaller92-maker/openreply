/**
 * Keyword registry: every word that fires a campaign, per Instagram account.
 *
 * One rule: a word belongs to ONE active campaign per account. Two active
 * campaigns answering the same word would both DM the person, and nobody could
 * tell which message a post was promising. Campaigns on "any post" keep their
 * words working on old posts too, which is why the word is the identity, not
 * the post.
 */
import { prisma } from "@/lib/db/client";
import { foldDiacritics } from "@/lib/utils/keyword-matcher";

export function normalizeKeyword(word: string): string {
  return foldDiacritics(word).trim().toLowerCase();
}

export interface KeywordConflict {
  keyword: string;
  campaignId: string;
  campaignName: string;
}

/** Words among `keywords` already used by another ACTIVE campaign on the account. */
export async function findKeywordConflicts(args: {
  workspaceId: string;
  instagramAccountId: string;
  keywords: string[];
  excludeAutomationId?: string;
}): Promise<KeywordConflict[]> {
  const wanted = new Set(args.keywords.map(normalizeKeyword).filter(Boolean));
  if (wanted.size === 0) return [];

  const others = await prisma.automation.findMany({
    where: {
      workspaceId: args.workspaceId,
      instagramAccountId: args.instagramAccountId,
      isActive: true,
      matchAnyWord: false,
      ...(args.excludeAutomationId ? { id: { not: args.excludeAutomationId } } : {}),
    },
    select: { id: true, name: true, keywords: true },
  });

  const conflicts: KeywordConflict[] = [];
  for (const other of others) {
    for (const word of other.keywords) {
      if (wanted.has(normalizeKeyword(word))) {
        conflicts.push({ keyword: word, campaignId: other.id, campaignName: other.name });
      }
    }
  }
  return conflicts;
}

export function conflictMessage(conflicts: KeywordConflict[]): string {
  const list = conflicts.map((c) => `"${c.keyword}" (${c.campaignName})`).join(", ");
  return `These keywords are already used by an active campaign on this account: ${list}. Pause that campaign or pick other words.`;
}

export interface RegistryRow {
  keyword: string;
  account: string;
  campaignId: string;
  campaignName: string;
  scope: "ANY_POST" | "NEXT_REEL" | "SPECIFIC_POST";
  postUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  sent: number;
  duplicated: boolean;
}

/** Every keyword of every campaign in the workspace, newest campaign first. */
export async function keywordRegistry(workspaceId: string): Promise<RegistryRow[]> {
  const campaigns = await prisma.automation.findMany({
    where: { workspaceId },
    select: {
      id: true,
      name: true,
      keywords: true,
      matchAnyWord: true,
      matchAnyPost: true,
      pendingNextReel: true,
      postUrl: true,
      isActive: true,
      createdAt: true,
      instagramAccount: { select: { username: true } },
      _count: { select: { dmLogs: { where: { status: "SENT" } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows: RegistryRow[] = [];
  for (const c of campaigns) {
    const words = c.matchAnyWord ? ["(any word)"] : c.keywords;
    for (const keyword of words) {
      rows.push({
        keyword,
        account: c.instagramAccount.username,
        campaignId: c.id,
        campaignName: c.name,
        scope: c.matchAnyPost ? "ANY_POST" : c.pendingNextReel ? "NEXT_REEL" : "SPECIFIC_POST",
        postUrl: c.postUrl,
        isActive: c.isActive,
        createdAt: c.createdAt,
        sent: c._count.dmLogs,
        duplicated: false,
      });
    }
  }
  // Flag any word that two active campaigns on one account share (legacy data).
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.isActive) continue;
    const key = `${r.account}:${normalizeKeyword(r.keyword)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const r of rows) {
    if (r.isActive && (seen.get(`${r.account}:${normalizeKeyword(r.keyword)}`) ?? 0) > 1) r.duplicated = true;
  }
  return rows;
}
