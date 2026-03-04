import { getLastTransactions, getRoundById, getAllBetsForRound, getOddsForRound, markUserActive } from '../store/persistence';
import { getOrCreateUser, getUserByShortId, getUserByTelegramUsername, SystemState } from '../store/game-state';
import { placeBet } from '../commands/bet';
import { openRound, closeRound, reopenRound, setResult, confirmSettlement, warnResetSystem, confirmResetSystem, cmdReverseRound, cmdViewRoundFlex } from '../commands/round';
import { openOdds, closeOdds, cmdCancelOdds, cmdUncancelOdds, cmdViewOdds } from '../commands/odds';
import { manageCredit, setRole, cmdUserInfo } from '../commands/user';
import { cmdUserList, cmdBettingBoard, cmdListAdmins, cmdHelp, cmdHowToPlay } from '../commands/info';
import { cmdStats, cmdTx, cmdExportTx, cmdActiveCredit, cmdExportAc, cmdExportBetting, cmdBettingSummary, cmdExportSum, cmdFlexTestBetHistory, cmdFlexTestTx, cmdFlexTestCloseOdds, cmdFlexTestCloseRound, cmdFlexTestActiveCredit, cmdFlexTestBettingSummary } from '../commands/stats';
import { cmdBankBetting, cmdBankCarousel, cmdBankHelp, cmdAddBank, cmdShowBank, cmdManageBank, cmdSetAdminLink } from '../commands/account';
import { cmdSetOddsCompact, cmdSetBetCompact, cmdSetTxCompact, cmdSetRoundCompact, cmdSetAcCompact, cmdSetSumCompact, cmdSetXCap, cmdSetDefMaxBet, cmdSetDefMinBet, cmdSetDefLim, cmdSetDefVig, cmdGetXCap, cmdGetDefMaxBet, cmdGetDefMinBet, cmdGetDefLim, cmdGetDefVig, cmdCompactPanel, cmdSettingsPanel, cmdGetRisk, cmdSetRisk, cmdGetDelay, cmdSetDelay, cmdGetMentionAll, cmdSetMentionAll } from '../commands/setup';
import { ReplyBuilder } from '../utils/response';
import { generateCreditFlex } from '../flex/credit-flex';
import { fetchAndSaveLineProfile } from '../platform/line-profile';
import type { BettingRound, CommandResult, GroupType, LineMessage, Mention, ReplyContext, UserRole, UserState } from '../types';

const mentionProfileFetchAttempted = new Set<string>();

function addFlexes(rb: ReplyBuilder, flexes: LineMessage[]): ReplyBuilder {
    for (const f of flexes) rb.flex(f.contents, f.altText ?? '');
    return rb;
}

function flexResult(flexes: LineMessage[]): CommandResult {
    return addFlexes(ReplyBuilder.create(), flexes).build();
}

function buildWelcomeForTarget(target: UserState, groupId: string): CommandResult {
    target.wasJustCreated = false;
    if (target.platform === 'LINE' && !mentionProfileFetchAttempted.has(target.userId)) {
        mentionProfileFetchAttempted.add(target.userId);
        queueMicrotask(() => { fetchAndSaveLineProfile(target, groupId); });
    }
    const flexes = generateCreditFlex({ user: target, transactions: [], currentRound: null, settledRound: null, showWelcome: true });
    const rb = ReplyBuilder.create().textV2UserMention(target.userId, 'ยินดีต้อนรับ {u0} 🎉');
    return addFlexes(rb, flexes).build();
}

interface CommandContext {
    userId: string;
    groupId: string;
    text: string;
    match: RegExpMatchArray;
    sender: UserState;
    groupType: GroupType;
    mentions?: Mention[];
    replyContext: ReplyContext;
}

interface CommandDef {
    pattern: RegExp;
    allowedRoles: UserRole[];
    allowedGroups: GroupType[];
    handler: (ctx: CommandContext) => CommandResult;
}

const ALL_ROLES: UserRole[] = ['CUSTOMER', 'ADMIN', 'MASTER'];
const PRIVILEGED: UserRole[] = ['ADMIN', 'MASTER'];
const BOTHGROUPS: GroupType[] = ['BETTING', 'BACKOFFICE'];
const ALLGROUPS: GroupType[] = ['BETTING', 'NOTIFY', 'BACKOFFICE'];

function handleBet(ctx: CommandContext): CommandResult {
    const m = ctx.match;
    const sideChar = (m[1] ?? m[4])!;
    const amount = parseInt((m[2] ?? m[3])!, 10);
    const side = sideChar === 'ด' ? 'RED' as const : 'BLUE' as const;
    return placeBet(ctx.userId, side, amount, ctx.replyContext);
}

function buildCreditFlex(user: UserState) {
    if (user.role === 'ADMIN' || user.role === 'MASTER') {
        return generateCreditFlex({
            user,
            transactions: [],
            currentRound: null,
            settledRound: null,
        });
    }

    const round = SystemState.currentRound;
    const currentBets = round
        ? round.bets.filter(b => b.userId === user.userId && b.status !== 'VOID')
        : [];
    const isUnsettled = round && round.status !== 'COMPLETED' && currentBets.length > 0;

    let settledRound: BettingRound | null = null;
    if (!isUnsettled) {
        for (let i = SystemState.roundsHistory.length - 1; i >= 0; i--) {
            const r = SystemState.roundsHistory[i]!;
            if (r.bets.some(b => b.userId === user.userId && b.status !== 'VOID')) {
                settledRound = r;
                break;
            }
        }
    }

    if (!isUnsettled && !settledRound) {
        return generateCreditFlex({
            user,
            transactions: [],
            currentRound: null,
            settledRound: null,
        });
    }

    return generateCreditFlex({
        user,
        transactions: [],
        currentRound: isUnsettled ? round : null,
        settledRound,
    });
}

function buildCreditFlexRound(user: UserState, roundShortId: number) {
    let round: BettingRound | null = null;
    if (SystemState.currentRound && SystemState.currentRound.id === roundShortId) {
        round = SystemState.currentRound;
    } else {
        round = SystemState.roundsHistory.find(r => r.id === roundShortId) ?? null;
    }
    if (!round) {
        const row = getRoundById(roundShortId);
        if (row) {
            const oddsRows = getOddsForRound(roundShortId);
            const betRows = getAllBetsForRound(roundShortId);
            round = {
                id: row.id,
                status: row.status as BettingRound['status'],
                result: (row.result ?? undefined) as BettingRound['result'],
                startedAt: row.created_at,
                oddsHistory: oddsRows.map(o => ({
                    redLossRatio: o.red_loss_ratio, redWinRatio: o.red_win_ratio,
                    blueLossRatio: o.blue_loss_ratio, blueWinRatio: o.blue_win_ratio,
                    status: o.status as import('../types').BettingOdds['status'],
                    maxBet: o.max_bet, minBet: o.min_bet, userLimit: o.user_limit, vig: o.vig,
                    fixedOddsKey: o.fixed_odds_key ?? undefined,
                })),
                bets: betRows.map(b => ({
                    userId: b.user_id,
                    oddsIndex: b.odds_index,
                    side: b.side as 'RED' | 'BLUE',
                    amount: b.amount,
                    winAmount: b.win_amount,
                    lossAmount: b.loss_amount,
                    status: b.status as import('../types').BetStatus,
                    timestamp: b.created_at,
                })),
            };
        }
    }
    if (!round) throw new Error(`❌ ไม่พบรอบ #r${roundShortId}`);

    const userBets = round.bets.filter(b => b.userId === user.userId && b.status !== 'VOID');
    if (userBets.length === 0) throw new Error(`❌ คุณไม่มีเดิมพันในรอบ #r${roundShortId}`);

    const isCompleted = round.status === 'COMPLETED';
    return generateCreditFlex({
        user,
        transactions: [],
        currentRound: isCompleted ? null : round,
        settledRound: isCompleted ? round : null,
    });
}

function buildCreditFlexFull(user: UserState) {
    const transactions = getLastTransactions(user.userId, 999);
    return generateCreditFlex({
        user,
        transactions,
        currentRound: null,
        settledRound: null,
        allTransactions: true,
    });
}

function handleCredit(ctx: CommandContext): CommandResult {
    const flexes = buildCreditFlexFull(ctx.sender);
    const rb = addFlexes(ReplyBuilder.create(), flexes);
    const round = SystemState.currentRound;
    if (round && round.bets.some(b => b.userId === ctx.sender.userId && b.status !== 'VOID')) {
        rb.text('กด CC เพื่อเช็คประวัติการเดิมพัน');
    }
    return rb.build();
}

function handleCreditRound(ctx: CommandContext): CommandResult {
    return flexResult(buildCreditFlexRound(ctx.sender, parseInt(ctx.match[1]!, 10)));
}

function handleCreditRoundOther(ctx: CommandContext): CommandResult {
    const target = getUserByShortId(parseInt(ctx.match[2]!, 10));
    if (!target) throw new Error(`❌ ไม่พบ user #u${ctx.match[2]}`);
    markUserActive(target);
    return flexResult(buildCreditFlexRound(target, parseInt(ctx.match[1]!, 10)));
}

function handleCreditRoundMention(ctx: CommandContext): CommandResult {
    if (!ctx.mentions || ctx.mentions.length === 0) throw new Error('❌ ไม่พบการ mention user');
    const roundShortId = parseInt(ctx.match[1]!, 10);
    const mention = ctx.mentions[0]!;
    let target: UserState | undefined;
    if (mention.userId) {
        target = getOrCreateUser(mention.userId, { platform: mention.platform, autoAdmin: false });
    } else if (mention.username) {
        target = getUserByTelegramUsername(mention.username);
        if (!target) throw new Error(`❌ ไม่พบ user @${mention.username} ในระบบ (ต้องเคยทักมาก่อน)`);
    } else {
        throw new Error('❌ ไม่พบการ mention user');
    }
    markUserActive(target);
    if (target.wasJustCreated) return buildWelcomeForTarget(target, ctx.groupId);
    return flexResult(buildCreditFlexRound(target, roundShortId));
}

function handleCreditFull(ctx: CommandContext): CommandResult {
    return flexResult(buildCreditFlex(ctx.sender));
}

function handleCreditOther(ctx: CommandContext): CommandResult {
    const target = getUserByShortId(parseInt(ctx.match[1]!, 10));
    if (!target) throw new Error(`ไม่พบ user #u${ctx.match[1]}`);
    markUserActive(target);
    return flexResult(buildCreditFlexFull(target));
}

function handleCreditMention(ctx: CommandContext): CommandResult {
    if (!ctx.mentions || ctx.mentions.length === 0) throw new Error('❌ ไม่พบการ mention user');
    const mention = ctx.mentions[0]!;
    let target: UserState | undefined;
    if (mention.userId) {
        target = getOrCreateUser(mention.userId, { platform: mention.platform, autoAdmin: false });
    } else if (mention.username) {
        target = getUserByTelegramUsername(mention.username);
        if (!target) throw new Error(`❌ ไม่พบ user @${mention.username} ในระบบ (ต้องเคยทักมาก่อน)`);
    } else {
        throw new Error('❌ ไม่พบการ mention user');
    }
    markUserActive(target);
    if (target.wasJustCreated) return buildWelcomeForTarget(target, ctx.groupId);
    return flexResult(buildCreditFlexFull(target));
}

function handleCreditFullOther(ctx: CommandContext): CommandResult {
    const target = getUserByShortId(parseInt(ctx.match[1]!, 10));
    if (!target) throw new Error(`ไม่พบ user #u${ctx.match[1]}`);
    markUserActive(target);
    return flexResult(buildCreditFlex(target));
}

function handleCreditFullMention(ctx: CommandContext): CommandResult {
    if (!ctx.mentions || ctx.mentions.length === 0) throw new Error('❌ ไม่พบการ mention user');
    const mention = ctx.mentions[0]!;
    let target: UserState | undefined;
    if (mention.userId) {
        target = getOrCreateUser(mention.userId, { platform: mention.platform, autoAdmin: false });
    } else if (mention.username) {
        target = getUserByTelegramUsername(mention.username);
        if (!target) throw new Error(`❌ ไม่พบ user @${mention.username} ในระบบ (ต้องเคยทักมาก่อน)`);
    } else {
        throw new Error('❌ ไม่พบการ mention user');
    }
    markUserActive(target);
    if (target.wasJustCreated) return buildWelcomeForTarget(target, ctx.groupId);
    return flexResult(buildCreditFlex(target));
}

function handleResult(ctx: CommandContext): CommandResult {
    const w = ctx.match[1] === 'ด' ? 'RED' as const : ctx.match[1] === 'ง' ? 'BLUE' as const : 'DRAW' as const;
    return setResult(w);
}

const commands: CommandDef[] = [
    { pattern: /^#u(\d+)([+\-=])(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => manageCredit(ctx.text) },
    { pattern: /^#u(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdUserInfo(parseInt(ctx.match[1]!)) },
    { pattern: /^master\s+#u(\d+)$/i, allowedRoles: ['MASTER'], allowedGroups: ALLGROUPS, handler: ctx => setRole(ctx.text) },
    { pattern: /^(admin|customer)\s+#u(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ALLGROUPS, handler: ctx => setRole(ctx.text) },

    { pattern: /^ยกยก(\d+)?$/, allowedRoles: PRIVILEGED, allowedGroups: ["BETTING"], handler: ctx => cmdUncancelOdds(ctx.text) },
    { pattern: /^ยก(\d+)?$/, allowedRoles: PRIVILEGED, allowedGroups: ["BETTING"], handler: ctx => cmdCancelOdds(ctx.text) },

    { pattern: /^#o(\d+)r(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: BOTHGROUPS, handler: ctx => cmdViewOdds(parseInt(ctx.match[1]!), parseInt(ctx.match[2]!)) },
    { pattern: /^#o(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: BOTHGROUPS, handler: ctx => cmdViewOdds(parseInt(ctx.match[1]!)) },
    { pattern: /^#o$/i, allowedRoles: PRIVILEGED, allowedGroups: BOTHGROUPS, handler: () => cmdViewOdds(undefined) },

    { pattern: /^#r(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: BOTHGROUPS, handler: ctx => cmdViewRoundFlex(parseInt(ctx.match[1]!), ctx.groupType) },
    { pattern: /^#r$/i, allowedRoles: PRIVILEGED, allowedGroups: BOTHGROUPS, handler: ctx => cmdViewRoundFlex(undefined, ctx.groupType) },

    { pattern: /^r(\d+)?$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BETTING"], handler: ctx => cmdReverseRound(ctx.text) },

    { pattern: /^o$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BETTING'], handler: () => openRound() },
    { pattern: /^x$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BETTING'], handler: () => closeRound() },
    { pattern: /^xx$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BETTING'], handler: () => reopenRound() },
    { pattern: /^y$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BETTING'], handler: () => confirmSettlement() },
    { pattern: /^rscf$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => confirmResetSystem() },
    { pattern: /^rs$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => warnResetSystem() },
    { pattern: /^s([ดงส])$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BETTING'], handler: handleResult },

    { pattern: /^[ดงส](\/[\d.]+){1,}/, allowedRoles: PRIVILEGED, allowedGroups: ['BETTING'], handler: ctx => openOdds(ctx.text) },
    { pattern: /^(ป|ปด)$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BETTING'], handler: () => closeOdds() },

    { pattern: /^cp$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdCompactPanel() },
    { pattern: /^st$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdSettingsPanel() },
    { pattern: /^ofc=([01])$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetOddsCompact(ctx.match[1] === '1') },
    { pattern: /^bfc=([01])$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetBetCompact(ctx.match[1] === '1') },
    { pattern: /^tfc=([01])$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetTxCompact(ctx.match[1] === '1') },
    { pattern: /^rfc=([01])$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetRoundCompact(ctx.match[1] === '1') },
    { pattern: /^acfc=([01])$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetAcCompact(ctx.match[1] === '1') },
    { pattern: /^sumfc=([01])$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetSumCompact(ctx.match[1] === '1') },
    { pattern: /^all$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdGetMentionAll() },
    { pattern: /^all=([01])$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetMentionAll(ctx.match[1] === '1') },
    { pattern: /^xcap$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdGetXCap() },
    { pattern: /^maxbet$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdGetDefMaxBet() },
    { pattern: /^minbet$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdGetDefMinBet() },
    { pattern: /^lim$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdGetDefLim() },
    { pattern: /^vig$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdGetDefVig() },
    { pattern: /^xcap=(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetXCap(parseInt(ctx.match[1]!, 10)) },
    { pattern: /^risk$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdGetRisk() },
    { pattern: /^risk=(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetRisk(parseInt(ctx.match[1]!, 10)) },
    { pattern: /^delay$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdGetDelay() },
    { pattern: /^delay=(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetDelay(parseInt(ctx.match[1]!, 10)) },
    { pattern: /^maxbet=(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetDefMaxBet(parseInt(ctx.match[1]!, 10)) },
    { pattern: /^minbet=(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetDefMinBet(parseInt(ctx.match[1]!, 10)) },
    { pattern: /^lim=(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetDefLim(parseInt(ctx.match[1]!, 10)) },
    { pattern: /^vig=(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: ctx => cmdSetDefVig(parseInt(ctx.match[1]!, 10)) },

    { pattern: /^stats$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdStats() },
    { pattern: /^tx$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdTx() },
    { pattern: /^extx$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdExportTx() },
    { pattern: /^ac$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdActiveCredit() },
    { pattern: /^exac$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdExportAc() },
    { pattern: /^exab$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdExportBetting() },
    { pattern: /^sum$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdBettingSummary() },
    { pattern: /^exsum$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdExportSum() },

    { pattern: /^fa(\d+)$/i, allowedRoles: ['MASTER'], allowedGroups: ['BACKOFFICE'], handler: ctx => cmdFlexTestBetHistory(parseInt(ctx.match[1]!)) },
    { pattern: /^fb(\d+)$/i, allowedRoles: ['MASTER'], allowedGroups: ['BACKOFFICE'], handler: ctx => cmdFlexTestTx(parseInt(ctx.match[1]!)) },
    { pattern: /^fc(\d+)$/i, allowedRoles: ['MASTER'], allowedGroups: ['BACKOFFICE'], handler: ctx => cmdFlexTestCloseOdds(parseInt(ctx.match[1]!)) },
    { pattern: /^fd(\d+)$/i, allowedRoles: ['MASTER'], allowedGroups: ['BACKOFFICE'], handler: ctx => cmdFlexTestCloseRound(parseInt(ctx.match[1]!)) },
    { pattern: /^fe(\d+)$/i, allowedRoles: ['MASTER'], allowedGroups: ['BACKOFFICE'], handler: ctx => cmdFlexTestActiveCredit(parseInt(ctx.match[1]!)) },
    { pattern: /^ff(\d+)$/i, allowedRoles: ['MASTER'], allowedGroups: ['BACKOFFICE'], handler: ctx => cmdFlexTestBettingSummary(parseInt(ctx.match[1]!)) },

    { pattern: /^u$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdUserList() },
    { pattern: /^a$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdListAdmins() },
    { pattern: /^b$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdBettingBoard() },
    { pattern: /^h$/i, allowedRoles: PRIVILEGED, allowedGroups: ["BACKOFFICE"], handler: () => cmdHelp() },

    { pattern: /^c\s+(?!#u\d+$).+/i, allowedRoles: PRIVILEGED, allowedGroups: ALLGROUPS, handler: handleCreditMention },
    { pattern: /^c\s+#u(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ALLGROUPS, handler: handleCreditOther },
    { pattern: /^c(\d+)\s+(?!#u\d+$).+/i, allowedRoles: PRIVILEGED, allowedGroups: ALLGROUPS, handler: handleCreditRoundMention },
    { pattern: /^c(\d+)\s+#u(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ALLGROUPS, handler: handleCreditRoundOther },
    { pattern: /^c(\d+)$/i, allowedRoles: ['CUSTOMER'], allowedGroups: ALLGROUPS, handler: handleCreditRound },
    { pattern: /^c$/i, allowedRoles: ALL_ROLES, allowedGroups: ALLGROUPS, handler: handleCredit },
    { pattern: /^cc\s+(?!#u\d+$).+/i, allowedRoles: PRIVILEGED, allowedGroups: ALLGROUPS, handler: handleCreditFullMention },
    { pattern: /^cc\s+#u(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ALLGROUPS, handler: handleCreditFullOther },
    { pattern: /^cc$/i, allowedRoles: ['CUSTOMER'], allowedGroups: ALLGROUPS, handler: handleCreditFull },

    { pattern: /^ว$/i, allowedRoles: ALL_ROLES, allowedGroups: ALLGROUPS, handler: () => cmdHowToPlay() },

    { pattern: /^#b0\s+bank=/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: ctx => cmdAddBank(ctx.text) },
    { pattern: /^#b0$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdBankHelp() },
    { pattern: /^#b(\d+)=(active|delete|image)$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: ctx => cmdManageBank(parseInt(ctx.match[1]!), ctx.match[2]!, ctx.groupId) },
    { pattern: /^#b(\d+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: ctx => cmdShowBank(parseInt(ctx.match[1]!)) },
    { pattern: /^al=(.+)$/i, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: ctx => cmdSetAdminLink(ctx.match[1]!.trim()) },
    { pattern: /^บช$/, allowedRoles: PRIVILEGED, allowedGroups: ['BACKOFFICE'], handler: () => cmdBankCarousel() },

    { pattern: /^บช$/, allowedRoles: ALL_ROLES, allowedGroups: ['BETTING'], handler: () => cmdBankBetting() },

    { pattern: /^([ดง])\s*(\d+)$|^(\d+)\s*([ดง])$/, allowedRoles: ["CUSTOMER"], allowedGroups: ['BETTING'], handler: handleBet },
];

export function dispatch(
    userId: string,
    groupId: string,
    text: string,
    sender: UserState,
    groupType: GroupType,
    mentions?: Mention[],
    replyContext?: ReplyContext,
): CommandResult | null {
    text = text.trim();
    for (const cmd of commands) {
        const match = text.match(cmd.pattern);
        if (!match) continue;

        if (!cmd.allowedGroups.includes(groupType)) {
            if (cmd.allowedGroups.includes('BETTING') && groupType === 'NOTIFY') {
                return ReplyBuilder.create()
                    .text('❌ คำสั่งนี้ใช้ได้เฉพาะกลุ่ม BETTING เท่านั้น')
                    .build();
            }
            continue;
        }

        if (!cmd.allowedRoles.includes(sender.role)) {
            return ReplyBuilder.create()
                .text('❌ ไม่มีสิทธิ์ใช้คำสั่งนี้')
                .build();
        }

        try {
            return cmd.handler({ userId, groupId, text, match, sender, groupType, mentions, replyContext: replyContext! });
        } catch (e: any) {
            return ReplyBuilder.create()
                .text(`❌ ${e.message}`)
                .build();
        }
    }

    return null; // ไม่ตรงคำสั่งใดๆ → ignore
}
