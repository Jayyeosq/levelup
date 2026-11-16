// A runner's public card: opened by tapping someone in the feed, leaderboard or friends list.
// Shows only what the leaderboard and Battle map already show. Never an email, a run or a route.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Share, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import * as cm from '../lib/community';
import { titleOf } from '../lib/game';
import { Avatar, Btn, C, Icon, num, s, Stat } from './ui';

export type RunnerRef = { id: string; username: string; avatar: string; level?: number; home_town?: string | null };

const NUDGE_MSG: Record<string, string> = {
  sent: 'Nudge sent.',
  already: 'You already nudged them today.',
  full: "They've already had 3 nudges today. Try again tomorrow.",
  no_phone: "They haven't turned on alerts yet, so a nudge can't reach them.",
  not_friends: 'You can only nudge friends.',
};

export default function RunnerCard({ runner, onClose }: { runner: RunnerRef | null; onClose: () => void }) {
  const { userId } = useAuth();
  const [card, setCard] = useState<cm.RunnerCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [canMessage, setCanMessage] = useState(false); // the nudge couldn't be delivered: offer a message instead

  useEffect(() => {
    setCard(null); setNote(null); setCanMessage(false);
    if (!runner) return;
    let live = true;
    setLoading(true);
    cm.fetchRunnerCard(runner.id).then((c) => { if (live) setCard(c); }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [runner?.id]);

  if (!runner) return null;
  const level = card?.level ?? runner.level;
  const town = card?.home_town ?? runner.home_town;
  const f = card?.friendship;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true); setNote(null);
    try { setNote(await fn()); } catch (e: any) { setNote(e?.message ?? 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };
  const add = () => run(async () => { await cm.requestFriend(runner.id); setCard((c) => (c ? { ...c, friendship: 'sent' } : c)); return 'Friend request sent.'; });
  const accept = () => run(async () => { if (userId) await cm.acceptFrom(runner.id, userId); setCard((c) => (c ? { ...c, friendship: 'friends' } : c)); return `You and @${runner.username} are now friends.`; });
  const nudge = () => run(async () => { const r = await cm.nudge(runner.id); setCanMessage(r === 'no_phone'); return NUDGE_MSG[r] ?? 'Nudge sent.'; });

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.ov} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" style={{ position: 'absolute', right: 16, top: 16, zIndex: 2 }}>
            <Icon name="x" color={C.mut} size={20} />
          </Pressable>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <Avatar a={card?.avatar ?? runner.avatar} size={84} ring={C.line2} />
            <Text style={[s.title, { marginTop: 12, fontSize: 22 }]}>@{runner.username}</Text>
            <Text style={s.sub}>
              {level ? `Level ${level} · ${titleOf(level)}` : ' '}{town ? ` · ${town}` : ''}
            </Text>
          </View>

          {card ? (
            <>
              <View style={s.row}>
                <Stat value={String(card.tiles_held)} label="tiles held" />
                <Stat value={card.week_xp.toLocaleString()} label="XP this week" />
                <Stat value={String(card.king_of.length)} label={card.king_of.length === 1 ? 'town ruled' : 'towns ruled'} />
              </View>
              {card.king_of.length > 0 && (
                <Text style={[s.sub, num, { textAlign: 'center', marginTop: 12, color: C.txt }]}>👑 King of {card.king_of.join(', ')}</Text>
              )}
            </>
          ) : loading ? <ActivityIndicator color={C.acc} style={{ marginVertical: 20 }} /> : null}

          <Text style={[s.sub, { textAlign: 'center', minHeight: 18, marginTop: 12, color: C.txt }]}>{note ?? ''}</Text>

          {busy ? <ActivityIndicator color={C.acc} style={{ marginVertical: 14 }} /> : (
            <View style={{ marginTop: 4, gap: 8 }}>
              {f === 'none' && <Btn title="Add friend" icon="user-plus" onPress={add} />}
              {f === 'incoming' && <Btn title="Accept friend request" icon="check" onPress={accept} />}
              {f === 'sent' && <Text style={[s.sub, { textAlign: 'center' }]}>Friend request sent. Waiting for them to accept.</Text>}
              {f === 'friends' && <Btn title="Nudge to run" icon="bell" onPress={nudge} />}
              {f === 'friends' && canMessage && <Btn title="Send a message instead" kind="ghost" icon="message-circle" onPress={() => { Share.share({ message: cm.NUDGE_TEXT }).catch(() => {}); }} />}
              {f === 'friends' && !canMessage && <Text style={[s.sub, { textAlign: 'center', marginTop: 0 }]}>You're friends. A nudge sends them a notification, once a day.</Text>}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
