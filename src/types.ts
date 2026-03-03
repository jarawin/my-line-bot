export type UserRole = 'CUSTOMER' | 'ADMIN' | 'MASTER';
export type Platform = 'LINE' | 'TELEGRAM';
export type GroupType = 'BETTING' | 'NOTIFY' | 'BACKOFFICE';

export interface AllowedGroup {
    id: string;
    platform: Platform;
    type: GroupType;
    name: string;
    createdAt: number;
}

export interface UserState {
    userId: string;
    shortId: number;
    role: UserRole;
    platform: Platform;
    credit: number;
    creditHold: number;
    currentRoundRedNet: number;
    currentRoundBlueNet: number;
    oddsBetCounts: Map<string, number>;  // oddsIndex(string) → bet count (transient, RAM only)
    totalTurnover: number;  // cumulative bet amount (persisted)
    totalWin: number;       // cumulative win amount (persisted)
    totalLoss: number;      // cumulative loss amount (persisted, positive)
    isInGroup: boolean;     // persisted; true when in group, false when leaves
    isActive: boolean;      // persisted; true after first message in group, reset on `rscf`
    isBetting: boolean;        // RAM-only; true after first bet, reset on `rs`
    isProfileLoaded: boolean;  // RAM-only; true after profile fetch attempt completes (success or fail)
    wasJustCreated: boolean;   // RAM-only; true only during first event after user creation; cleared after welcome is sent
    telegramUsername?: string;  // Telegram @username (without @) for mention lookup
    displayName?: string;       // LINE display name (fetched in background)
    profilePictureUrl?: string; // LINE profile picture URL (fetched in background)
}

export interface BankAccount {
    shortId:   number;
    bank:      string;
    name:      string;
    number:    string;
    imageUrl?: string;
    isActive:  boolean;
}

export interface SystemStats {
    globalTurnover: number;
    globalDeposit:  number;
    globalWithdraw: number;
    houseWin:       number;
    houseLoss:      number;   // cumulative house loss (positive number)
}

export interface BettingOdds {
    redLossRatio: number;
    redWinRatio: number;
    blueLossRatio: number;
    blueWinRatio: number;
    status: 'OPEN' | 'CLOSED' | 'CANCELLED';
    maxBet: number;
    minBet: number;
    userLimit: number;
    vig: number;
    fixedOddsKey?: string;  // set for fixed odds entries (e.g., "ด/50/1") for display reconstruction
}

export interface BetImpact {
    winAmount: number;
    lossAmount: number;
    newRedNet: number;
    newBlueNet: number;
    newCreditHold: number;
}

export type BetStatus = 'PENDING' | 'WON' | 'LOST' | 'DRAW' | 'VOID';

export interface Bet {
    userId: string;
    oddsIndex: number;   // index ใน round.oddsHistory ที่ bet ถูกวางตอนราคานั้น
    side: 'RED' | 'BLUE';
    amount: number;
    winAmount: number;
    lossAmount: number;
    timestamp: number;
    status: BetStatus;
}

export type RoundStatus = 'OPEN' | 'CLOSED' | 'WAITING_PAYMENT' | 'COMPLETED';
export type RoundResult = 'RED' | 'BLUE' | 'DRAW';

export interface BettingRound {
    id: number;
    bets: Bet[];
    oddsHistory: BettingOdds[];
    status: RoundStatus;
    startedAt: number;
    result?: RoundResult;
}

export interface SettlementReport {
    roundId: number;
    totalBets: number;
    totalPayout: number;
    casinoProfit: number;
}

export type TransactionType = 'DEPOSIT' | 'WITHDRAW' | 'BET_WIN' | 'BET_LOSS' | 'BET_DRAW' | 'REFUND' | 'ADJUSTMENT';

export interface Transaction {
    id: number;
    userId: string;
    amount: number;
    type: TransactionType;
    refId: string;
    createdAt: number;
}

// ---------------------------------------------------------------------------
// Platform-specific reply context
// ---------------------------------------------------------------------------

export interface LineReplyContext {
    type: 'LINE';
    replyToken: string;
    quoteToken?: string;
}

export interface TelegramReplyContext {
    type: 'TELEGRAM';
    chatId: number;
    messageId: number;
}

export type ReplyContext = LineReplyContext | TelegramReplyContext;

// ---------------------------------------------------------------------------
// Mention data
// ---------------------------------------------------------------------------

export interface Mention {
    userId?: string;  // For text_mention (has user.id)
    username?: string;  // For mention (has @username only)
    platform: Platform;
}

export interface MentionData {
    userId: string;
    displayName: string;  // Display name for UI (e.g., "John Doe" or "#u2")
    platform: Platform;
}

// ---------------------------------------------------------------------------
// Normalized Event — unified input from all platforms
// ---------------------------------------------------------------------------

export interface NormalizedEvent {
    platform: Platform;
    userId: string;
    groupId: string;
    text: string;
    replyContext: ReplyContext;
    mentions?: Mention[];
    telegramUsername?: string;  // Telegram @username (for username tracking)
    webhookId: number;
    eventIndex: number;
    totalEvents: number;
    receivedAt: number;
    transportMs: number;
}

// ---------------------------------------------------------------------------
// Rich Reply / Notification structures
// ---------------------------------------------------------------------------

export interface LineMessage {
    type: 'text' | 'textV2' | 'image' | 'video' | 'flex' | 'sticker';
    text?: string;
    originalContentUrl?: string;
    previewImageUrl?: string;
    altText?: string;
    contents?: unknown;
    packageId?: string;
    stickerId?: string;
    quoteToken?: string;
    mention?: {
        mentionees: Array<{
            index: number;
            length: number;
            userId: string;
        }>;
    };
    substitution?: Record<string, {
        type: 'mention' | 'emoji';
        mentionee?: {
            type: 'all' | 'user';
            userId?: string;
        };
        productId?: string;
        emojiId?: string;
    }>;
}

export interface AdminNotification {
    topic: string;
    message: string;
    level: 'INFO' | 'WARN' | 'DANGER';
}

export interface PendingBet {
    betId:          string;
    userId:         string;
    roundId:        number;
    oddsIndex:      number;
    side:           'RED' | 'BLUE';
    amount:         number;
    winAmount:      number;
    lossAmount:     number;
    placedAt:       number;
    warning?:       string;
    // snapshot for reversal on VOID
    prevRedNet:     number;
    prevBlueNet:    number;
    prevCreditHold: number;
    prevOddsCount:  number;
    // reply context (LINE: replyToken | Telegram: chatId)
    replyContext:   ReplyContext;
    timer:          ReturnType<typeof setTimeout>;
}

export interface CommandResult {
    messages: string[];  // text fallback for every slot (used by Telegram)
    lineMessages?: LineMessage[];  // rich LINE messages (flex/image) — replaces the slot at lineMessageIndices[i]
    lineMessageIndices?: number[];  // which messages[] slot each lineMessage replaces (parallel array)
    notifications: AdminNotification[];
    mentions?: MentionData[];  // Users to mention in reply
    mentionAtIndex?: number;  // Index of message to attach mentions to (default: 0)
    quoteIndices?: number[];  // Indices of messages that should quote the original message (LINE only)
}
