import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { USERNAME_RE, useAuth } from '../lib/auth';
import { supabaseReady } from '../lib/supabase';
import Intro from './Intro';
import { Btn, C, Hex, Icon, s } from './ui';

const INTRO_KEY = 'levelup.intro.seen';

const input = { backgroundColor: C.card2, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 14, color: C.txt, fontSize: 16, marginBottom: 10 } as const;

export default function AuthScreen() {
  const { signIn, signUp, sendReset, resetPassword } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('signup');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false); // forgot password: has the code been emailed?
  const [ident, setIdent] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);

  const submit = async () => {
    setMsg(null); setBusy(true);
    try {
      if (mode === 'login') {
        if (!ident || !password) throw new Error('Enter your email or username, and your password.');
        await signIn(ident, password);
      } else if (mode === 'forgot') {
        if (!sent) {
          await sendReset(email);
          setSent(true); setPassword('');
          setMsg({ kind: 'ok', text: 'If that email has an account, we sent it a code. Enter it below with a new password.' });
        } else {
          await resetPassword(email, code, password); // success logs you in
        }
      } else {
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Enter a valid email.');
        const r = await signUp(email, username, password);
        if (r === 'confirm_email') {
          setMsg({ kind: 'ok', text: 'We sent you an email. Tap the link to confirm, then log in here.' });
          setMode('login'); setIdent(username);
        }
      }
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? String(e) }); }
    finally { setBusy(false); }
  };

  // First launch on this phone: show the three intro screens before the form.
  const [intro, setIntro] = useState<boolean | null>(null); // null = still checking
  useEffect(() => { AsyncStorage.getItem(INTRO_KEY).then((v) => setIntro(v !== '1')).catch(() => setIntro(false)); }, []);

  const unameOk = !username || USERNAME_RE.test(username);
  const tab = mode === 'forgot' ? 'login' : mode;

  if (intro === null) return <View style={[s.screen, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100 }]} />;
  if (intro) return <Intro onDone={() => { setIntro(false); AsyncStorage.setItem(INTRO_KEY, '1').catch(() => {}); }} />;

  return (
    <SafeAreaView style={[s.screen, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100 }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 48 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <Hex size={64}><Icon name="chevrons-up" size={28} color={C.onAcc} /></Hex>
          </View>
          <Text style={{ color: C.txt, fontSize: 32, fontWeight: '600', textAlign: 'center' }}>LevelUp<Text style={{ color: C.acc }}>+</Text></Text>
          <Text style={[s.sub, { textAlign: 'center', marginBottom: 28, fontSize: 15 }]}>Run. Earn XP. Claim your turf.</Text>

          <View style={{ flexDirection: 'row', backgroundColor: C.card2, borderRadius: 12, padding: 4, marginBottom: 18 }}>
            {(['signup', 'login'] as const).map((m) => (
              <Pressable key={m} onPress={() => { setMode(m); setMsg(null); setSent(false); }} style={{ flex: 1, paddingVertical: 10, borderRadius: 9, backgroundColor: tab === m ? C.acc : 'transparent' }}>
                <Text style={{ color: tab === m ? C.onAcc : C.sec, fontWeight: '600', textAlign: 'center' }}>{m === 'signup' ? 'Sign up' : 'Log in'}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'login' ? (
            <TextInput value={ident} onChangeText={setIdent} placeholder="Email or username" placeholderTextColor={C.mut}
              autoCapitalize="none" autoCorrect={false} textContentType="username" style={input} />
          ) : mode === 'forgot' ? (
            <>
              <Text style={[s.sub, { marginTop: 0, marginBottom: 10 }]}>
                {sent ? 'Enter the code from the email and choose a new password.' : 'Enter the email you signed up with. We\'ll send you a code to set a new password.'}
              </Text>
              <TextInput value={email} onChangeText={(t) => { setEmail(t); setSent(false); }} placeholder="Email" placeholderTextColor={C.mut}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" style={input} />
              {sent && (
                <TextInput value={code} onChangeText={setCode} placeholder="Code from the email" placeholderTextColor={C.mut}
                  keyboardType="number-pad" textContentType="oneTimeCode" maxLength={10} style={input} />
              )}
            </>
          ) : (
            <>
              <TextInput value={email} onChangeText={setEmail} placeholder="Email (private — never shown)" placeholderTextColor={C.mut}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" style={input} />
              <TextInput value={username} onChangeText={setUsername} placeholder="Username (what others see)" placeholderTextColor={C.mut}
                autoCapitalize="none" autoCorrect={false} maxLength={20} style={[input, !unameOk && { borderColor: C.bad }]} />
              <Text style={[s.sub, { marginTop: -4, marginBottom: 10, fontSize: 12, color: unameOk ? C.mut : C.bad }]}>
                3–20 letters, numbers or _. You can't change it later.
              </Text>
            </>
          )}
          {(mode !== 'forgot' || sent) && (
            <TextInput value={password} onChangeText={setPassword}
              placeholder={mode === 'signup' ? 'Password (8+ characters)' : mode === 'forgot' ? 'New password (8+ characters)' : 'Password'}
              placeholderTextColor={C.mut} secureTextEntry autoCapitalize="none" textContentType={mode === 'login' ? 'password' : 'newPassword'} style={input} />
          )}

          {msg && <Text style={{ color: msg.kind === 'err' ? C.bad : C.good, marginBottom: 10, fontSize: 14 }}>{msg.text}</Text>}
          {busy ? <ActivityIndicator color={C.acc} style={{ marginVertical: 16 }} /> :
            <Btn title={mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : sent ? 'Set new password' : 'Send reset code'} onPress={submit} style={{ marginTop: 6 }} />}

          {mode === 'login' && !busy && (
            <Pressable onPress={() => { setMode('forgot'); setMsg(null); setSent(false); setCode(''); setPassword(''); if (ident.includes('@')) setEmail(ident.trim()); }} hitSlop={10} style={{ alignSelf: 'center', marginTop: 16 }}>
              <Text style={{ color: C.acc, fontWeight: '500' }}>Forgot password?</Text>
            </Pressable>
          )}
          {mode === 'forgot' && !busy && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 16 }}>
              {sent && <Pressable onPress={() => { setSent(false); setMsg(null); setCode(''); }} hitSlop={10}><Text style={{ color: C.sec, fontWeight: '500' }}>Send a new code</Text></Pressable>}
              <Pressable onPress={() => { setMode('login'); setMsg(null); setSent(false); }} hitSlop={10}><Text style={{ color: C.acc, fontWeight: '500' }}>Back to log in</Text></Pressable>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 20 }}>
            <Icon name="lock" size={13} color={C.mut} />
            <Text style={[s.sub, { marginTop: 0, fontSize: 12 }]}>Others only see your username. Your email and routes stay private.</Text>
          </View>
          {!supabaseReady && <Text style={[s.sub, { textAlign: 'center', marginTop: 12, color: C.bad }]}>Developer note: add supabaseKey in app.json (see ACCOUNTS_SETUP.md).</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
