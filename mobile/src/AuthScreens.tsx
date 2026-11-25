import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, getErrorMessage, hasApiUrl } from './api';
import { useSession } from './session';
import type { RootStackParamList } from './routes';
import type { User } from './types';
import { Button, Card, ChoiceRow, Field, Loading, Notice, Page, uiStyles } from './ui';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export function SignInScreen() {
  const { setAuthenticated, error: sessionError } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function login() {
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/auth/login', { username: username.trim(), password });
      const data = response.data as { token?: string; user?: User; message?: string };
      if (!data.token || !data.user) throw new Error('The server response did not contain a login session.');
      await setAuthenticated(data.token, data.user);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <Card style={{
        width: '90%', maxWidth: 400, alignSelf: 'center', marginTop: 48, padding: 28,
        backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.3)',
        borderRadius: 20, shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
      }}>
        <Field label="" placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoComplete="username" returnKeyType="next" />
        <Field label="" placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={login} />
        {!hasApiUrl() && <Notice tone="error">Configure EXPO_PUBLIC_API_URL with your reachable existing API address before signing in.</Notice>}
        <Notice tone="error">{sessionError}</Notice>
        <Notice tone="error">{error}</Notice>
        <Button title={busy ? 'Signing in…' : 'Login'} onPress={login} disabled={busy || !hasApiUrl()} />
        {busy && <Loading label="Connecting to the attendance server" />}
      </Card>
    </Page>
  );
}

export function ClassSelectScreen() {
  const { user, setAuthenticated, clearSession } = useSession();
  const [classId, setClassId] = useState(user?.program === 'PG' ? 'PGCS1' : 'CS1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = user?.program === 'PG' ? ['PGCS1', 'PGCS2'] :
    user?.program === 'All' ? ['CS1', 'CS2', 'CS3', 'PGCS1', 'PGCS2'] : ['CS1', 'CS2', 'CS3'];

  async function selectClass() {
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/auth/select-class', { classId });
      const data = response.data as { token?: string; user?: User };
      if (!data.token || !data.user) throw new Error('The server did not return the selected class session.');
      await setAuthenticated(data.token, data.user);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await clearSession();
    } catch (reason) {
      Alert.alert('Logout', getErrorMessage(reason));
    }
  }

  return (
    <Page title="Select Your Class">
      <Card>
        <Text style={uiStyles.body}>Logged in as {user?.name}</Text>
        <ChoiceRow label="Class" options={choices} value={classId} onChange={setClassId} />
        <Notice tone="error">{error}</Notice>
        <Button title={busy ? 'Selecting…' : 'Continue'} onPress={selectClass} disabled={busy} />
        <Button title="Logout" tone="red" onPress={logout} />
      </Card>
    </Page>
  );
}

const adminActions: Array<{
  label: string;
  route: keyof RootStackParamList;
  tone?: 'blue' | 'purple' | 'green' | 'red';
  daily?: boolean;
  overview?: boolean;
  periods?: boolean;
}> = [
  { label: 'Student Registration Requests', route: 'Requests' },
  { label: 'Upload Students', route: 'ExcelUpload' },
  { label: 'Students Data', route: 'Students' },
  { label: 'Daily Report', route: 'Reports', daily: true },
  { label: 'Detailed Report', route: 'Reports' },
  { label: 'Admin Report Overview', route: 'Reports', overview: true },
  { label: 'Period Attendance Report', route: 'Reports', periods: true },
  { label: 'Period Attendance', route: 'Attendance' },
  { label: 'Staff Management', route: 'Staff' },
  { label: 'Messages', route: 'Messages' },
  { label: 'Notification History', route: 'Notifications' },
  { label: 'Delete Student Data', route: 'DeleteData', tone: 'red' },
];

export function DashboardScreen() {
  const navigation = useNavigation<Navigation>();
  const { user, clearSession, error: sessionError } = useSession();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return <Loading />;

  async function logout() {
    setBusy(true);
    try {
      await clearSession();
    } catch (reason) {
      Alert.alert('Logout', getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const academicYear = user.year === '1' ? '1st Year' : user.year === '2' ? '2nd Year' : user.year === '3' ? '3rd Year' : `${user.year}th Year`;
  const classId = user.classId || `${user.program === 'PG' ? 'PGCS' : 'CS'}${user.year}`;

  return (
    <Page>
      <Card style={user.role === 'admin' ? { maxWidth: 480, alignSelf: 'center' } : undefined}>
        <Text style={uiStyles.heading}>{user.role === 'admin'
          ? 'Administrator'
          : `Welcome, ${user.department} - ${user.program} ${academicYear} (${classId})`}</Text>
        <Notice tone="error">{sessionError}</Notice>
        <View style={user.role === 'admin'
          ? { marginTop: 16, width: '100%', maxWidth: 400, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }
          : { marginTop: 16 }}>
          {user.role === 'admin' ? adminActions.map(({ label, route, tone, daily, overview, periods }) => (
            <Button key={label} title={label} tone={tone || 'blue'} style={{ width: '48%', maxWidth: 190, margin: 0, borderRadius: 10, paddingHorizontal: 10 }} onPress={() => {
              if (route === 'Reports') navigation.navigate('Reports', { daily, overview, periods });
              else if (route === 'Attendance') navigation.navigate('Attendance', { mode: 'period' });
              else if (route === 'Requests') navigation.navigate('Requests');
              else if (route === 'Staff') navigation.navigate('Staff');
              else if (route === 'ExcelUpload') navigation.navigate('ExcelUpload');
              else if (route === 'Students') navigation.navigate('Students');
              else if (route === 'DeleteData') navigation.navigate('DeleteData');
              else if (route === 'Notifications') navigation.navigate('Notifications');
              else if (route === 'Messages') navigation.navigate('Messages');
            }} />
          )) : (
            <>
              <Button title="Attendance" onPress={() => navigation.navigate('Attendance', { mode: 'period' })} />
              <Button title="Daily Report" onPress={() => navigation.navigate('Reports', { daily: true })} />
            </>
          )}
          <Button title={busy ? 'Logging out…' : 'Logout'} tone="red" onPress={logout} disabled={busy} />
          <Notice tone="error">{error}</Notice>
        </View>
      </Card>
    </Page>
  );
}
