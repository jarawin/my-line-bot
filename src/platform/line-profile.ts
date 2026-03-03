import { saveUser } from '../store/persistence';
import type { UserState } from '../types';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const LINE_API = 'https://api.line.me/v2/bot';

async function fetchGroupMemberProfile(groupId: string, userId: string): Promise<{ displayName: string; pictureUrl?: string } | null> {
    const res = await fetch(`${LINE_API}/group/${groupId}/member/${userId}`, {
        headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { displayName?: string; pictureUrl?: string };
    if (!data.displayName) return null;
    return { displayName: data.displayName, pictureUrl: data.pictureUrl };
}

async function fetchUserProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string } | null> {
    const res = await fetch(`${LINE_API}/profile/${userId}`, {
        headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { displayName?: string; pictureUrl?: string };
    if (!data.displayName) return null;
    return { displayName: data.displayName, pictureUrl: data.pictureUrl };
}

export async function fetchAndSaveLineProfile(user: UserState, groupId: string): Promise<void> {
    try {
        let profile = await fetchGroupMemberProfile(groupId, user.userId);
        if (!profile) {
            profile = await fetchUserProfile(user.userId);
        }
        if (profile) {
            user.displayName = profile.displayName;
            user.profilePictureUrl = profile.pictureUrl;
            saveUser(user);
        }
        user.isProfileLoaded = true;
    } catch (err) {
        console.error(`[PROFILE] Failed to fetch profile for ${user.userId}:`, err);
        user.isProfileLoaded = true;
    }
}
