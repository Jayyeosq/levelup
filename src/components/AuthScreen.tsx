import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { USERNAME_RE, useAuth } from '../lib/auth';
import { supabaseReady } from '../lib/supabase';
import { Btn, C, Hex, Icon, s } from './ui';

const input = { backgroundColor: C.card2, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 14, color: C.txt, fontSize: 16, marginBottom: 10 } as const;

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
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

  const unameOk = !username || USERNAME_RE.test(username);

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
              <Pressable key={m} onPress={() => { setMode(m); setMsg(null); }} style={{ flex: 1, paddingVertical: 10, borderRadius: 9, backgroundColor: mode === m ? C.acc : 'transparent' }}>
                <Text style={{ color: mode === m ? C.onAcc : C.sec, fontWeight: '600', textAlign: 'center' }}>{m === 'signup' ? 'Sign up' : 'Log in'}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'login' ? (
            <TextInput value={ident} onChangeText={setIdent} placeholder="Email or username" placeholderTextColor={C.mut}
              autoCapitalize="none" autoCorrect={false} textContentType="username" style={input} />
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
          <TextInput value={password} onChangeText={setPassword} placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'}
            placeholderTextColor={C.mut} secureTextEntry autoCapitalize="none" textContentType={mode === 'signup' ? 'newPassword' : 'password'} style={input} />

          {msg && <Text style={{ color: msg.kind === 'err' ? C.bad : C.good, marginBottom: 10, fontSize: 14 }}>{msg.text}</Text>}
          {busy ? <ActivityIndicator color={C.acc} style={{ marginVertical: 16 }} /> :
            <Btn title={mode === 'signup' ? 'Create account' : 'Log in'} onPress={submit} style={{ marginTop: 6 }} />}

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
