import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, FlatList, Image, Pressable, ScrollView, Switch, Text, View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { api, getErrorMessage } from './api';
import { sharePdf, shareSpreadsheet } from './exports';
import * as storage from './storage';
import type { RootStackParamList } from './routes';
import { useSession } from './session';
import type { AttendanceRecord, RequestItem, Student } from './types';
import { Button, Card, ChoiceRow, Field, Loading, Notice, Page, Row, uiStyles } from './ui';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type NativeFile = { uri: string; name: string; type: string };
type NativeFormData = FormData & { append(name: string, value: NativeFile): void };
const departments = ['Computer Science', 'Information Technology', 'Tamil', 'English'];
const periodAttendanceSchedule: Record<string, { start: number; end: number; label: string }> = {
  '1': { start: 9 * 60 + 30, end: 9 * 60 + 45, label: '9:30 AM–9:45 AM' },
  '2': { start: 10 * 60 + 20, end: 10 * 60 + 30, label: '10:20 AM–10:30 AM' },
  '3': { start: 11 * 60 + 15, end: 11 * 60 + 25, label: '11:15 AM–11:25 AM' },
  '4': { start: 12 * 60 + 30, end: 12 * 60 + 40, label: '12:30 PM–12:40 PM' },
  '5': { start: 13 * 60 + 20, end: 13 * 60 + 30, label: '1:20 PM–1:30 PM' },
};
const indiaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const indiaTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type PeriodReportSummary = {
  period: number;
  records: number;
  present: number;
  absent: number;
  percentage: number;
  absentStudents?: Array<Pick<AttendanceRecord, 'studentId' | 'studentName'>>;
};

function appendNativeFile(form: FormData, name: string, file: NativeFile) {
  (form as NativeFormData).append(name, file);
}

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayInIndia(): string {
  const parts = indiaDateFormatter.formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function getIndiaMinutesNow(): number {
  const parts = indiaTimeFormatter.formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return hour * 60 + minute;
}

function isPeriodWindowOpen(period: string, minutes: number): boolean {
  const window = periodAttendanceSchedule[period];
  return minutes >= window.start && minutes < window.end;
}

function yearLabel(year: string): string {
  return year === '1' ? '1st Year' : year === '2' ? '2nd Year' : year === '3' ? '3rd Year' : `${year}th Year`;
}

function formatRequest(item: RequestItem): string {
  return `${item.studentName} · ${item.studentRegisterNumber || item.studentId || ''} · ${item.status.toUpperCase()}`;
}

function getClassId(department: string, program: string, year: string): string {
  const name = department.trim().toLowerCase();
  if (name.includes('computer')) return program === 'PG' ? `PGCS${year}` : `CS${year}`;
  if (name.includes('information')) return `IT${year}`;
  return `${department.trim().slice(0, 3).toUpperCase()}${year}`;
}

function getClassOptions(department: string, program: string): string[] {
  if (department.toLowerCase().includes('computer')) {
    return program === 'PG' ? ['PGCS1', 'PGCS2'] : ['CS1', 'CS2', 'CS3'];
  }
  if (department.toLowerCase().includes('information')) return program === 'PG' ? ['IT1', 'IT2'] : ['IT1', 'IT2', 'IT3'];
  const prefix = department.trim().slice(0, 3).toUpperCase();
  return [`${prefix}1`, `${prefix}2`, `${prefix}3`];
}

function getAbsentStudents(records: AttendanceRecord[]): AttendanceRecord[] {
  return records
    .filter((record) => record.status === 'absent')
    .sort((left, right) => left.studentId.localeCompare(right.studentId, undefined, { numeric: true }));
}

export function AttendanceScreen() {
  const { user } = useSession();
  const route = useRoute<RouteProp<RootStackParamList, 'Attendance'>>();
  const periodMode = route.params?.mode === 'period';
  const [date, setDate] = useState(todayInIndia());
  const [period, setPeriod] = useState('1');
  const [indiaMinutes, setIndiaMinutes] = useState(getIndiaMinutesNow);
  const [department, setDepartment] = useState(user?.role === 'admin' ? 'Computer Science' : user?.department || 'Computer Science');
  const [program, setProgram] = useState<'UG' | 'PG'>(user?.program === 'PG' ? 'PG' : 'UG');
  const [year, setYear] = useState(user?.year && user.year !== 'All' ? user.year : '1');
  const [classId, setClassId] = useState(user?.classId || getClassId('Computer Science', 'UG', '1'));
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, 'present' | 'absent'>>({});
  const [periodLocked, setPeriodLocked] = useState(false);
  const [periodCorrectionAllowed, setPeriodCorrectionAllowed] = useState(false);
  const [absenceReport, setAbsenceReport] = useState<{
    date: string;
    period: string;
    classId: string;
    absentees: AttendanceRecord[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setIndiaMinutes(getIndiaMinutesNow()), 15000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setAbsenceReport(null);
    setPeriodCorrectionAllowed(false);
    setLoading(true);
    setError('');
    try {
      const scope = user.role === 'admin' ? { department, year, program, classId } : undefined;
      const [studentResponse, attendanceResponse] = await Promise.all([
        api.get('/students', { params: scope }),
        api.get(periodMode ? '/attendance/periods' : '/attendance', {
          params: {
            date,
            ...(periodMode ? { period } : {}),
            ...(scope || {}),
          },
        }),
      ]);
      const nextStudents = (studentResponse.data.students || []) as Student[];
      const records = (periodMode
        ? attendanceResponse.data.record?.records || []
        : attendanceResponse.data.records || []) as AttendanceRecord[];
      const current: Record<string, 'present' | 'absent'> = {};
      nextStudents.forEach((student) => { current[student.studentId] = 'present'; });
      records.forEach((record) => { current[record.studentId] = record.status; });
      setStudents(nextStudents);
      setAttendance(current);
      setPeriodLocked(periodMode && Boolean(attendanceResponse.data.record?.locked));
      setPeriodCorrectionAllowed(periodMode && Boolean(attendanceResponse.data.record) && !attendanceResponse.data.record?.locked);
      if (periodMode && attendanceResponse.data.record) {
        setAbsenceReport({
          date,
          period,
          classId: String(attendanceResponse.data.record.classId || attendanceResponse.data.classId || user.classId || classId),
          absentees: getAbsentStudents(records),
        });
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [classId, date, department, period, periodMode, program, user, year]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function submit() {
    if (periodMode && user?.role === 'staff' && !periodCorrectionAllowed && !isPeriodWindowOpen(period, getIndiaMinutesNow())) {
      setError(`Period ${period} attendance can only be submitted from ${periodAttendanceSchedule[period].label} IST.`);
      return;
    }
    if (!students.length) {
      setError('There are no active students in this class.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const records: AttendanceRecord[] = students.map((student) => ({
        studentId: student.studentId,
        studentName: student.studentName,
        status: attendance[student.studentId] || 'present',
      }));
      const scope = {
        department: user?.role === 'admin' ? department : user?.department,
        year: user?.role === 'admin' ? year : user?.year,
        program: user?.role === 'admin' ? program : user?.program === 'All' ? 'UG' : user?.program,
        classId: user?.role === 'admin' ? classId : user?.classId,
      };
      const response = await api.post('/attendance/mark', {
        date,
        ...scope,
        ...(periodMode ? { period: Number(period) } : {}),
        records,
      });
      setMessage(response.data.message || 'Attendance saved.');
      await load();
      if (periodMode) {
        const savedRecords = (response.data.record?.records || records) as AttendanceRecord[];
        setAbsenceReport({
          date,
          period,
          classId: String(scope.classId || classId),
          absentees: getAbsentStudents(savedRecords),
        });
        setPeriodLocked(true);
        setPeriodCorrectionAllowed(false);
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function unlockPeriod() {
    Alert.alert('Unlock attendance period', `Allow changes to Period ${period} for ${date}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlock',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError('');
            setMessage('');
            try {
              await api.patch('/attendance/periods/unlock', {
                date,
                period: Number(period),
                department,
                year,
                program,
                classId,
              });
              setPeriodLocked(false);
              setPeriodCorrectionAllowed(false);
              setAbsenceReport(null);
              setMessage(`Period ${period} is unlocked for corrections.`);
            } catch (reason) {
              setError(getErrorMessage(reason));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  const absentCount = Object.values(attendance).filter((value) => value === 'absent').length;
  const periodWindowOpen = isPeriodWindowOpen(period, indiaMinutes);

  async function shareAbsenceReport() {
    if (!absenceReport || absenceReport.absentees.length === 0) return;
    try {
      await sharePdf(
        `Period ${absenceReport.period} Absentee Report · ${absenceReport.date}`,
        ['S.No.', 'Roll Number', 'Student Name', 'Status'],
        absenceReport.absentees.map((student, index) => [index + 1, student.studentId, student.studentName, 'Absent']),
      );
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }

  return (
    <Page title={periodMode ? 'Five-period Attendance' : 'Daily Attendance'}>
      <Card>
        {user?.role === 'admin' && (
          <>
            <ChoiceRow label="Department" options={departments} value={department} onChange={(value) => {
              setDepartment(value);
              setClassId(getClassId(value, program, year));
            }} />
            <ChoiceRow label="Programme" options={['UG', 'PG']} value={program} onChange={(value) => {
              const nextProgram = value as 'UG' | 'PG';
              setProgram(nextProgram);
              setYear('1');
              setClassId(getClassId(department, nextProgram, '1'));
            }} />
            <ChoiceRow label="Year" options={program === 'PG' ? ['1', '2'] : ['1', '2', '3']} value={year} onChange={(value) => {
              setYear(value);
              setClassId(getClassId(department, program, value));
            }} />
            <ChoiceRow label="Class" options={getClassOptions(department, program)} value={classId} onChange={setClassId} />
          </>
        )}
        <Field label="Attendance date (YYYY-MM-DD)" value={date} onChangeText={setDate} editable={user?.role === 'admin'} />
        {periodMode && <ChoiceRow label="Period" options={['1', '2', '3', '4', '5']} value={period} onChange={setPeriod} />}
        <Text style={uiStyles.body}>Class: {user?.role === 'admin' ? classId : user?.classId || `${user?.program} ${yearLabel(user?.year || '1')}`}</Text>
        {periodMode && <Text style={uiStyles.muted}>
          Period {period} attendance window: {periodAttendanceSchedule[period].label} IST
          {user?.role === 'staff'
            ? (periodWindowOpen ? ' · Open now' : periodCorrectionAllowed ? ' · Correction unlocked' : ' · Closed')
            : ''}
        </Text>}
        {periodMode && <Text style={uiStyles.body}>Period status: {periodLocked ? 'Locked' : 'Not locked'}</Text>}
        <Text style={uiStyles.body}>Total: {students.length} · Present: {students.length - absentCount} · Absent: {absentCount}</Text>
        <Button title="Refresh" tone="clear" onPress={() => void load()} compact />
        {periodMode && user?.role === 'admin' && periodLocked && (
          <Button title="Unlock Period for Corrections" tone="red" onPress={unlockPeriod} disabled={busy || loading} />
        )}
        {loading ? <Loading /> : students.length === 0 ? <Notice>No active students were found for this class.</Notice> : (
          <FlatList
            data={students}
            keyExtractor={(item) => item._id}
            scrollEnabled={false}
            renderItem={({ item, index }) => {
              const isAbsent = attendance[item.studentId] === 'absent';
              return (
                <View style={uiStyles.item}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={uiStyles.body}>{item.serial || index + 1}. {item.studentName}</Text>
                      <Text style={uiStyles.muted}>{item.studentId}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityLabel={`${item.studentName} attendance`}
                      accessibilityState={{ checked: !isAbsent, disabled: periodMode && periodLocked }}
                      disabled={periodMode && periodLocked}
                      onPress={() => {
                        setAbsenceReport(null);
                        setAttendance((current) => ({
                          ...current,
                          [item.studentId]: isAbsent ? 'present' : 'absent',
                        }));
                      }}
                      style={({ pressed }) => ({
                        minHeight: 36,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingVertical: 6,
                        paddingHorizontal: 14,
                        borderRadius: 30,
                        backgroundColor: 'rgba(255,255,255,0.12)',
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.25)',
                        opacity: periodMode && periodLocked ? 0.55 : pressed ? 0.8 : 1,
                      })}
                    >
                      <View style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        borderWidth: 2,
                        borderColor: isAbsent ? '#ef4444' : '#22c55e',
                        backgroundColor: isAbsent ? '#ef4444' : 'rgba(34,197,94,0.25)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {isAbsent && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ffffff' }} />}
                      </View>
                      <Text style={{
                        color: isAbsent ? '#fca5a5' : '#4ade80',
                        backgroundColor: isAbsent ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.2)',
                        borderWidth: 1,
                        borderColor: isAbsent ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.4)',
                        borderRadius: 12,
                        paddingVertical: 3,
                        paddingHorizontal: 12,
                        fontSize: 13,
                        fontWeight: '700',
                        letterSpacing: 0.5,
                      }}>
                        {isAbsent ? 'Absent' : 'Present'}
                      </Text>
                    </Pressable>
                  </Row>
                </View>
              );
            }}
          />
        )}
        {absenceReport && periodMode && (
          <View style={uiStyles.item}>
            <Text style={uiStyles.heading}>Period {absenceReport.period} Absentee Report</Text>
            <Text style={uiStyles.body}>
              Date: {absenceReport.date} · Time: {periodAttendanceSchedule[absenceReport.period].label} IST · Class: {absenceReport.classId}
            </Text>
            <Text style={uiStyles.body}>Absent: {absenceReport.absentees.length}</Text>
            {absenceReport.absentees.length > 0 ? (
              <>
                {absenceReport.absentees.map((student, index) => (
                  <Text key={student.studentId} style={uiStyles.body}>
                    {index + 1}. {student.studentId} · {student.studentName}
                  </Text>
                ))}
                {user?.role === 'admin' && <Button title="Share Absentee Report (PDF)" tone="green" onPress={() => void shareAbsenceReport()} />}
              </>
            ) : <Notice tone="success">No absentees for this period. All students were marked present.</Notice>}
          </View>
        )}
        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{message}</Notice>
        <Button
          title={busy ? 'Submitting…' : periodMode ? 'Submit & Lock Period' : 'Submit Attendance'}
          onPress={() => void submit()}
          disabled={busy || loading || (periodMode && periodLocked) || (periodMode && user?.role === 'staff' && !periodWindowOpen && !periodCorrectionAllowed)}
        />
      </Card>
    </Page>
  );
}

export function StudentsScreen() {
  const navigation = useNavigation<Navigation>();
  const { user } = useSession();
  const [department, setDepartment] = useState(user?.role === 'admin' ? 'Computer Science' : user?.department || 'Computer Science');
  const [program, setProgram] = useState(user?.program === 'PG' ? 'PG' : 'UG');
  const [year, setYear] = useState(user?.year && user.year !== 'All' ? user.year : '1');
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const response = user.role === 'staff'
        ? await api.get('/students/allyears')
        : await api.get('/students', { params: { department, program, year } });
      setStudents((response.data.students || []) as Student[]);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [department, program, user, year]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));
  useEffect(() => {
    storage.getItemAsync('attendance.jwt')
      .then((value) => setToken(value || ''))
      .catch((reason: unknown) => setError(getErrorMessage(reason)));
  }, []);

  async function deleteStudent(student: Student) {
    Alert.alert('Delete student', `Delete ${student.studentName} (${student.studentId})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          void (async () => {
            try {
              await api.delete(`/students/${encodeURIComponent(student._id)}`, {
                params: { department: student.department, year: student.year, program: student.program, classId: student.classId },
              });
              await load();
            } catch (reason) { setError(getErrorMessage(reason)); }
          })();
        }
      },
    ]);
  }

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return students.filter((student) => !query ||
      student.studentName.toLowerCase().includes(query) || student.studentId.toLowerCase().includes(query));
  }, [search, students]);

  return (
    <Page title={user?.role === 'admin' ? 'Students Data' : 'Student Data'}>
      <Card>
        {user?.role === 'admin' ? (
          <>
            <ChoiceRow label="Department" options={departments} value={department} onChange={setDepartment} />
            <ChoiceRow label="Programme" options={['UG', 'PG']} value={program} onChange={(value) => { setProgram(value); setYear('1'); }} />
            <ChoiceRow label="Year" options={program === 'PG' ? ['1', '2'] : ['1', '2', '3']} value={year} onChange={setYear} />
          </>
        ) : null}
        <Field label="Search by name or register number" value={search} onChangeText={setSearch} />
        <Row>
          <Button title="Add Student" tone="green" onPress={() => navigation.navigate('StudentForm', {
            department, program: program as 'UG' | 'PG', year,
            classId: getClassId(department, program, year),
          })} />
          <Button title="Refresh" tone="clear" onPress={() => void load()} />
        </Row>
        <Row>
          <Button title="Export Excel" tone="green" compact onPress={() => {
            void shareSpreadsheet(`Students_${program}_${year}.xlsx`, visible.map((item, index) => ({
              Serial: item.serial || index + 1,
              'Register Number': item.studentId,
              'Student Name': item.studentName,
              Department: item.department,
              Programme: item.program,
              Year: item.year,
              Email: item.email || '',
              Phone: item.phone || '',
              'Parent Name': item.parentName || '',
              'Parent Phone': item.parentPhone || '',
              UMIS: item.umisId || '',
              ABC: item.abcId || '',
            }))).catch((reason: unknown) => setError(getErrorMessage(reason)));
          }} />
          <Button title="Export PDF" tone="purple" compact onPress={() => {
            const columns = ['S.No.', 'Register Number', 'Student Name', 'Department', 'Programme', 'Year', 'Phone'];
            void sharePdf('Student Data', columns, visible.map((item, index) => [
              item.serial || index + 1, item.studentId, item.studentName, item.department,
              item.program, item.year, item.phone || '',
            ])).catch((reason: unknown) => setError(getErrorMessage(reason)));
          }} />
        </Row>
        <Notice tone="error">{error}</Notice>
        {loading ? <Loading /> : visible.length === 0 ? <Notice>No students found.</Notice> : (
          <FlatList
            data={visible}
            keyExtractor={(item) => item._id}
            scrollEnabled={false}
            renderItem={({ item, index }) => (
              <View style={uiStyles.item}>
                <Row style={{ justifyContent: 'space-between' }}>
                  {token && item.photoId ? (
                    <Image
                      source={{
                        uri: api.getUri({ url: `/students/${encodeURIComponent(item._id)}/photo` }),
                        headers: { Authorization: `Bearer ${token}` },
                      }}
                      style={{ width: 44, height: 44, borderRadius: 22, marginRight: 8 }}
                    />
                  ) : item.photo ? (
                    <Image source={{ uri: item.photo }} style={{ width: 44, height: 44, borderRadius: 22, marginRight: 8 }} />
                  ) : null}
                  <View style={{ flex: 1, paddingRight: 6 }}>
                    <Text style={uiStyles.body}>{item.serial || index + 1}. {item.studentName}</Text>
                    <Text style={uiStyles.muted}>{item.studentId} · {item.department} · {item.program} {yearLabel(item.year)}</Text>
                    {item.parentSmsOptOut ? <Text style={uiStyles.muted}>Parent SMS opted out</Text> : null}
                  </View>
                  <Button title="Edit" compact onPress={() => navigation.navigate('StudentForm', { student: item })} />
                  <Button title="Delete" tone="red" compact onPress={() => void deleteStudent(item)} />
                </Row>
                {user?.role === 'admin' && (
                  <Row>
                    <Text style={uiStyles.body}>Parent SMS opt-out</Text>
                    <Switch
                      value={Boolean(item.parentSmsOptOut)}
                      onValueChange={async (value) => {
                        try {
                          await api.patch(`/students/${encodeURIComponent(item._id)}/parent-sms-opt-out`, { parentSmsOptOut: value });
                          await load();
                        } catch (reason) { setError(getErrorMessage(reason)); }
                      }}
                    />
                  </Row>
                )}
              </View>
            )}
          />
        )}
      </Card>
    </Page>
  );
}

export function StudentFormScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'StudentForm'>>();
  const { user } = useSession();
  const student = route.params?.student;
  const initialDepartment = student?.department || route.params?.department || (user?.role === 'admin' ? 'Computer Science' : user?.department || 'Computer Science');
  const initialProgram = student?.program || route.params?.program || (user?.program === 'PG' ? 'PG' : 'UG');
  const initialYear = student?.year || route.params?.year || (user?.role === 'admin' ? '1' : user?.year || '1');
  const [department, setDepartment] = useState(initialDepartment);
  const [program, setProgram] = useState<'UG' | 'PG'>(initialProgram);
  const [year, setYear] = useState(initialYear);
  const [classId, setClassId] = useState(student?.classId || route.params?.classId || getClassId(initialDepartment, initialProgram, initialYear));
  const [studentName, setStudentName] = useState(student?.studentName || '');
  const [studentId, setStudentId] = useState(student?.studentId || '');
  const [phone, setPhone] = useState(student?.phone || '');
  const [email, setEmail] = useState(student?.email || '');
  const [dateOfBirth, setDateOfBirth] = useState(student?.dateOfBirth?.slice(0, 10) || '');
  const [address, setAddress] = useState(student?.address || '');
  const [parentName, setParentName] = useState(student?.parentName || '');
  const [parentPhone, setParentPhone] = useState(student?.parentPhone || '');
  const [parentRelationship, setParentRelationship] = useState(student?.parentRelationship || '');
  const [gender, setGender] = useState(student?.gender || '');
  const [umisId, setUmisId] = useState(student?.umisId || '');
  const [abcId, setAbcId] = useState(student?.abcId || '');
  const [dayScholarHosteller, setDayScholarHosteller] = useState(student?.dayScholarHosteller || '');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoToken, setPhotoToken] = useState('');
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const existingPhoto = student?.photoId && photoToken && api.defaults.baseURL && !photoRemoved
    ? { uri: api.getUri({ url: `/students/${encodeURIComponent(student._id)}/photo` }), headers: { Authorization: `Bearer ${photoToken}` } }
    : student?.photo && !photoRemoved ? { uri: student.photo } : null;

  useEffect(() => {
    storage.getItemAsync('attendance.jwt')
      .then((token) => setPhotoToken(token || ''))
      .catch((reason: unknown) => setError(getErrorMessage(reason)));
  }, []);

  async function choosePhoto() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo library access is required to select a student photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (!result.canceled) {
        setPhoto(result.assets[0]);
        setPhotoRemoved(false);
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }

  async function removePhoto() {
    if (!student) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/students/${encodeURIComponent(student._id)}/photo`);
      setPhotoRemoved(true);
      setPhoto(null);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!studentName.trim() || !studentId.trim()) {
      setError('Student name and register number are required.');
      return;
    }
    setBusy(true);
    setError('');
    const payload = {
      studentName: studentName.trim(),
      ...(user?.role === 'admin' || !student ? {
        studentId: studentId.trim().toUpperCase(),
        department: user?.role === 'admin' ? department : user?.department,
        year: user?.role === 'admin' ? year : user?.year,
        program: user?.role === 'admin' ? program : user?.program === 'PG' ? 'PG' : 'UG',
        classId: user?.role === 'admin' ? classId : user?.classId,
      } : {}),
      phone, email, dateOfBirth, address, parentName, parentPhone,
      parentRelationship, gender, umisId, abcId, dayScholarHosteller,
    };
    try {
      if (student) {
        await api.put(`/students/${encodeURIComponent(student._id)}`, payload);
        if (photo) {
          const form = new FormData();
          appendNativeFile(form, 'photo', { uri: photo.uri, name: photo.fileName || 'student.jpg', type: photo.mimeType || 'image/jpeg' });
          await api.put(`/students/${encodeURIComponent(student._id)}/photo`, form);
        }
      } else if (user?.role === 'admin' && photo) {
        const form = new FormData();
        Object.entries(payload).forEach(([key, value]) => { if (value) form.append(key, String(value)); });
        appendNativeFile(form, 'photo', { uri: photo.uri, name: photo.fileName || 'student.jpg', type: photo.mimeType || 'image/jpeg' });
        await api.post('/students', form);
      } else {
        await api.post('/students/register', {
          ...payload,
          studentId: studentId.trim().toUpperCase(),
          department: user?.role === 'admin' ? department : user?.department,
          year: user?.role === 'admin' ? year : user?.year,
          program: user?.role === 'admin' ? program : user?.program === 'PG' ? 'PG' : 'UG',
          classId: user?.role === 'admin' ? classId : user?.classId,
        });
      }
      navigation.goBack();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={student ? 'Edit Student' : 'Register Student'}>
      <Card>
        <Text style={uiStyles.muted}>{student?.classId || user?.classId || `${user?.department} · ${user?.program} ${yearLabel(user?.year || '1')}`}</Text>
        {existingPhoto && !photo && <Image source={existingPhoto} style={{ width: 90, height: 90, alignSelf: 'center', margin: 8 }} />}
        {user?.role === 'admin' && (
          <>
            <ChoiceRow label="Department" options={departments} value={department} onChange={(value) => {
              setDepartment(value);
              setClassId(getClassId(value, program, year));
            }} />
            <ChoiceRow label="Programme" options={['UG', 'PG']} value={program} onChange={(value) => {
              const next = value as 'UG' | 'PG';
              setProgram(next);
              setYear('1');
              setClassId(getClassId(department, next, '1'));
            }} />
            <ChoiceRow label="Year" options={program === 'PG' ? ['1', '2'] : ['1', '2', '3']} value={year} onChange={(value) => {
              setYear(value);
              setClassId(getClassId(department, program, value));
            }} />
            <ChoiceRow label="Class" options={getClassOptions(department, program)} value={classId} onChange={setClassId} />
          </>
        )}
        <Field label="Student name *" value={studentName} onChangeText={setStudentName} />
        <Field label="Register number *" value={studentId} onChangeText={setStudentId} autoCapitalize="characters" editable={user?.role === 'admin' || !student} />
        <Field label="Student phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Date of birth (YYYY-MM-DD)" value={dateOfBirth} onChangeText={setDateOfBirth} />
        <Field label="Address" value={address} onChangeText={setAddress} multiline />
        <Field label="Parent / guardian name" value={parentName} onChangeText={setParentName} />
        <Field label="Parent / guardian phone" value={parentPhone} onChangeText={setParentPhone} keyboardType="phone-pad" />
        <Field label="Parent relationship" value={parentRelationship} onChangeText={setParentRelationship} />
        <ChoiceRow label="Gender" options={['', 'Male', 'Female', 'Other']} value={gender} onChange={setGender} />
        <Field label="UMIS ID" value={umisId} onChangeText={setUmisId} />
        <Field label="ABC ID" value={abcId} onChangeText={setAbcId} />
        <ChoiceRow label="Residence" options={['', 'Day Scholar', 'Hosteller']} value={dayScholarHosteller} onChange={setDayScholarHosteller} />
        {photo && <Image source={{ uri: photo.uri }} style={{ width: 90, height: 90, alignSelf: 'center', margin: 8 }} />}
        {(user?.role === 'admin' || Boolean(student)) && <Button title={photo ? 'Choose a different photo' : 'Choose student photo'} tone="clear" onPress={() => void choosePhoto()} />}
        {student && user?.role === 'staff' && existingPhoto && <Button title="Remove current photo" tone="red" onPress={() => void removePhoto()} disabled={busy} />}
        <Notice tone="error">{error}</Notice>
        <Button title={busy ? 'Saving…' : student ? 'Save Changes' : 'Register Student'} onPress={() => void save()} disabled={busy} />
      </Card>
    </Page>
  );
}

export function RequestFormScreen() {
  const navigation = useNavigation<Navigation>();
  const { user } = useSession();
  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [section, setSection] = useState('');
  const [phone, setPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!studentName.trim() || !studentId.trim()) {
      setError('Student name and register number are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/student-requests', {
        studentName: studentName.trim(),
        studentRegisterNumber: studentId.trim().toUpperCase(),
        department: user?.department,
        academicYear: user?.year,
        program: user?.program,
        classId: user?.classId,
        section, phone, parentPhone, reason,
      });
      Alert.alert('Request submitted', 'Your student registration request was sent to the Admin.');
      navigation.navigate('Requests');
    } catch (reasonValue) {
      setError(getErrorMessage(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Student Registration Request">
      <Card>
        <Text style={uiStyles.muted}>Class: {user?.classId || user?.department}</Text>
        <Field label="Student register number *" value={studentId} onChangeText={setStudentId} autoCapitalize="characters" />
        <Field label="Student name *" value={studentName} onChangeText={setStudentName} />
        <Field label="Section" value={section} onChangeText={setSection} />
        <Field label="Student phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="Parent phone" value={parentPhone} onChangeText={setParentPhone} keyboardType="phone-pad" />
        <Field label="Reason / remarks" value={reason} onChangeText={setReason} multiline />
        <Notice tone="error">{error}</Notice>
        <Button title={busy ? 'Submitting…' : 'Submit Request'} onPress={() => void submit()} disabled={busy} />
      </Card>
    </Page>
  );
}

export function RequestsScreen() {
  const navigation = useNavigation<Navigation>();
  const { user } = useSession();
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [rejectId, setRejectId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [program, setProgram] = useState('all');
  const [year, setYear] = useState('all');
  const [classId, setClassId] = useState('all');
  const [completeId, setCompleteId] = useState('');
  const [completeStudentId, setCompleteStudentId] = useState('');
  const [completeStudentName, setCompleteStudentName] = useState('');
  const [completeSection, setCompleteSection] = useState('');
  const [completePhone, setCompletePhone] = useState('');
  const [completeParentPhone, setCompleteParentPhone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = user?.role === 'admin'
        ? await api.get('/student-requests/all', {
          params: {
            ...(status === 'all' ? {} : { status }),
            ...(department.trim() ? { department: department.trim() } : {}),
            ...(program === 'all' ? {} : { program }),
            ...(year === 'all' ? {} : { year }),
            ...(classId === 'all' ? {} : { classId }),
          }
        })
        : await api.get('/student-requests/my-requests');
      setRequests((response.data.requests || []) as RequestItem[]);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [classId, department, program, status, user?.role, year]);

  useEffect(() => { void load(); }, [load]);

  async function approve(request: RequestItem) {
    setBusyId(request._id);
    setError('');
    try {
      await api.patch(`/student-requests/${request._id}/approve`, { remarks: 'Approved by Admin.' });
      await load();
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusyId(''); }
  }

  async function reject(request: RequestItem) {
    if (rejectId !== request._id) {
      setRejectId(request._id);
      setRejectReason('');
      return;
    }
    if (!rejectReason.trim()) {
      setError('Enter a reason before rejecting a request.');
      return;
    }
    setBusyId(request._id);
    setError('');
    try {
      await api.patch(`/student-requests/${request._id}/reject`, { reason: rejectReason.trim() });
      setRejectId('');
      setRejectReason('');
      await load();
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusyId(''); }
  }

  async function complete(request: RequestItem) {
    if (!completeStudentId.trim() || !completeStudentName.trim()) {
      setError('Student name and register number are required to complete registration.');
      return;
    }
    setBusyId(request._id);
    setError('');
    try {
      await api.post(`/student-requests/${request._id}/complete-registration`, {
        studentRegisterNumber: completeStudentId.trim(),
        studentName: completeStudentName.trim(),
        section: completeSection,
        phone: completePhone,
        parentPhone: completeParentPhone,
      });
      setCompleteId('');
      await load();
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusyId(''); }
  }

  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((item) => (!query ||
      item.studentName.toLowerCase().includes(query) ||
      String(item.studentId || item.studentRegisterNumber || '').toLowerCase().includes(query) ||
      String(item.requestedByName || item.requestedBy || '').toLowerCase().includes(query)) &&
      (user?.role === 'admin' || status === 'all' || item.status === status));
  }, [requests, search, status, user?.role]);

  return (
    <Page title={user?.role === 'admin' ? 'Student Registration Requests' : 'My Registration Requests'}>
      <Card>
        <Field label="Search by student or staff" value={search} onChangeText={setSearch} />
        {user?.role === 'admin' ? (
          <>
            <ChoiceRow label="Status" options={['all', 'pending', 'approved', 'rejected', 'completed']} value={status} onChange={setStatus} />
            <Field label="Department" value={department} onChangeText={setDepartment} />
            <ChoiceRow label="Programme" options={['all', 'UG', 'PG']} value={program} onChange={setProgram} />
            <ChoiceRow label="Academic year" options={['all', '1', '2', '3']} value={year} onChange={setYear} />
            <ChoiceRow label="Class" options={['all', 'CS1', 'CS2', 'CS3', 'PGCS1', 'PGCS2', 'IT1', 'IT2', 'IT3']} value={classId} onChange={setClassId} />
          </>
        ) : <ChoiceRow label="Status" options={['all', 'pending', 'approved', 'rejected', 'completed']} value={status} onChange={setStatus} />}
        {user?.role === 'staff' && <Button title="New Registration Request" tone="green" onPress={() => navigation.navigate('RequestForm')} />}
        <Row>
          <Button title="Refresh" tone="clear" onPress={() => void load()} />
          <Button title="Messages" onPress={() => navigation.navigate('Messages')} />
        </Row>
        <Notice tone="error">{error}</Notice>
        {loading ? <Loading /> : visibleRequests.length === 0 ? <Notice>No registration requests found.</Notice> : (
          <FlatList
            data={visibleRequests}
            keyExtractor={(item) => item._id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={uiStyles.item}>
                <Text style={uiStyles.body}>{formatRequest(item)}</Text>
                <Text style={uiStyles.muted}>{item.department} · {item.program} {yearLabel(String(item.year || item.academicYear || '1'))} · {item.classId || ''}</Text>
                {user?.role === 'admin' && <Text style={uiStyles.muted}>Requested by {item.requestedByName || item.requestedBy || 'Staff'}</Text>}
                {item.reason ? <Text style={uiStyles.muted}>Reason: {item.reason}</Text> : null}
                {item.rejectionReason || item.adminRemarks ? <Text style={uiStyles.muted}>Admin remarks: {item.rejectionReason || item.adminRemarks}</Text> : null}
                <Row>
                  <Button title="Open Messages" compact onPress={() => navigation.navigate('Messages', { requestId: item._id, title: item.studentName })} />
                  {user?.role === 'admin' && item.status === 'pending' && <>
                    <Button title={busyId === item._id ? '…' : 'Approve'} tone="green" compact onPress={() => void approve(item)} disabled={Boolean(busyId)} />
                    <Button title="Reject" tone="red" compact onPress={() => void reject(item)} disabled={Boolean(busyId)} />
                  </>}
                  {user?.role === 'staff' && item.status === 'approved' && !item.isCompleted && !item.completedStudentId &&
                    <Button title="Complete Registration" tone="green" compact onPress={() => {
                      setCompleteId(item._id);
                      setCompleteStudentId(item.studentRegisterNumber || item.studentId || '');
                      setCompleteStudentName(item.studentName);
                      setCompleteSection(item.section || '');
                      setCompletePhone(item.phone || '');
                      setCompleteParentPhone(item.parentPhone || '');
                    }} disabled={Boolean(busyId)} />}
                </Row>
                {user?.role === 'staff' && completeId === item._id && (
                  <>
                    <Field label="Register number *" value={completeStudentId} onChangeText={setCompleteStudentId} autoCapitalize="characters" />
                    <Field label="Student name *" value={completeStudentName} onChangeText={setCompleteStudentName} />
                    <Field label="Section" value={completeSection} onChangeText={setCompleteSection} />
                    <Field label="Student phone" value={completePhone} onChangeText={setCompletePhone} keyboardType="phone-pad" />
                    <Field label="Parent phone" value={completeParentPhone} onChangeText={setCompleteParentPhone} keyboardType="phone-pad" />
                    <Button title={busyId === item._id ? 'Completing…' : 'Confirm & Register Student'} tone="green" onPress={() => void complete(item)} disabled={Boolean(busyId)} />
                    <Button title="Cancel" tone="clear" compact onPress={() => setCompleteId('')} />
                  </>
                )}
                {rejectId === item._id && (
                  <>
                    <Field label="Rejection reason" value={rejectReason} onChangeText={setRejectReason} multiline />
                    <Button title="Confirm Rejection" tone="red" onPress={() => void reject(item)} disabled={Boolean(busyId)} />
                  </>
                )}
              </View>
            )}
          />
        )}
      </Card>
    </Page>
  );
}

export function ExcelUploadScreen() {
  const navigation = useNavigation<Navigation>();
  const { user } = useSession();
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [department, setDepartment] = useState(user?.department || 'Computer Science');
  const [program, setProgram] = useState(user?.program === 'PG' ? 'PG' : 'UG');
  const [year, setYear] = useState(user?.year && user.year !== 'All' ? user.year : '1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function chooseFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled) {
      setFile(result.assets[0]);
      setError('');
      setMessage('');
    }
  }

  async function upload() {
    if (!file) {
      setError('Choose an .xlsx or .xls file first.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const form = new FormData();
      form.append('department', department);
      form.append('program', program);
      form.append('year', year);
      form.append('classId', getClassId(department, program, year));
      appendNativeFile(form, 'file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const response = await api.post('/students/upload', form);
      setMessage(response.data.message || 'Excel file uploaded successfully.');
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Upload Students">
      <Card>
        <ChoiceRow label="Department" options={departments} value={department} onChange={setDepartment} />
        <ChoiceRow label="Programme" options={['UG', 'PG']} value={program} onChange={(value) => { setProgram(value); setYear('1'); }} />
        <ChoiceRow label="Year" options={program === 'PG' ? ['1', '2'] : ['1', '2', '3']} value={year} onChange={setYear} />
        <Button title="View Excel Upload Template" tone="clear" onPress={() => navigation.navigate('ExcelTemplate')} />
        <Button title={file ? 'Choose a different Excel file' : 'Choose Excel file (.xls / .xlsx)'} tone="clear" onPress={() => void chooseFile()} />
        {file && <Text style={uiStyles.body}>{file.name}</Text>}
        <Text style={uiStyles.muted}>The existing backend validates and processes the selected spreadsheet.</Text>
        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{message}</Notice>
        <Button title={busy ? 'Uploading…' : 'Upload'} onPress={() => void upload()} disabled={busy || !file} />
      </Card>
    </Page>
  );
}

type TemplateRowData = {
  values: string[];
  required?: boolean;
};

function TemplateTable({ headers, rows }: { headers: string[]; rows: TemplateRowData[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)' }}>
          {headers.map((header) => (
            <Text key={header} style={{ width: 170, padding: 10, color: '#ffffff', fontSize: 12, fontWeight: '700' }}>
              {header.toUpperCase()}
            </Text>
          ))}
        </View>
        {rows.map((row, rowIndex) => (
          <View key={`${rowIndex}:${row.values[0]}`} style={{
            flexDirection: 'row',
            backgroundColor: rowIndex % 2 === 1 ? 'rgba(0,0,0,0.1)' : 'transparent',
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(255,255,255,0.2)',
          }}>
            {row.values.map((value, index) => (
              <Text key={index} style={{
                width: 170, padding: 10, color: row.required && index === 2 ? '#ff6b6b' : '#ffffff',
                fontSize: 13, lineHeight: 19, fontWeight: row.required && index === 2 ? '700' : '400',
              }}>
                {value}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function TemplateSection({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <Card style={{
      padding: 20,
      marginBottom: 20,
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderWidth: 0,
      borderRadius: 10,
      shadowOpacity: 0,
    }}>
      <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700', marginBottom: 14, textAlign: 'center' }}>
        {title}
      </Text>
      {children}
    </Card>
  );
}

function TemplateNote({ children, tone = 'info' }: React.PropsWithChildren<{ tone?: 'info' | 'warning' | 'success' }>) {
  const colors = tone === 'warning'
    ? { background: 'rgba(255,193,7,0.2)', border: '#ffc107', text: '#856404' }
    : tone === 'success'
      ? { background: 'rgba(40,167,69,0.2)', border: '#28a745', text: '#155724' }
      : { background: 'rgba(23,162,184,0.3)', border: '#17a2b8', text: '#ffffff' };
  return (
    <View style={{
      backgroundColor: colors.background, borderLeftWidth: 4, borderLeftColor: colors.border,
      padding: 12, marginVertical: 6, borderRadius: 4,
    }}>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>{children}</Text>
    </View>
  );
}

export function ExcelTemplateScreen() {
  const navigation = useNavigation<Navigation>();
  const requiredRows: TemplateRowData[] = [
    { values: ['S.No or Serial Number', 'Number', 'Optional', 'Serial number (auto-generated if not provided)'] },
    { values: ['Reg Number or Student ID', 'Text', 'Required', 'Student register number / ID (unique)'], required: true },
    { values: ['Name or Student Name', 'Text', 'Required', 'Full name of the student'], required: true },
    { values: ['Department (from dropdown)', 'Select', 'Required', 'Selected in upload form'], required: true },
    { values: ['Year (from dropdown)', 'Select', 'Required', 'Selected in upload form'], required: true },
  ];
  const optionalRows: TemplateRowData[] = [
    { values: ['Email', 'Text', 'student@college.edu', 'Student email address'] },
    { values: ['Phone', 'Text', '9876543210', 'Student phone number'] },
    { values: ['Date of Birth or DOB', 'Text/Date', '2003-05-15 or 15/05/2003', "Student's date of birth"] },
    { values: ['Address', 'Text', '123 Gandhi Street, Chennai', "Student's residential address"] },
    { values: ['Parent Name', 'Text', 'Rajesh Kumar', 'Parent/Guardian name'] },
    { values: ['Parent Phone', 'Text', '9876543211', 'Parent/Guardian phone number'] },
    { values: ['Photo or Photo URL', 'Text', 'https://example.com/photo.jpg', 'Public photo URL or base64'] },
  ];

  return (
    <Page title="📝 Excel Upload Template - Student Details" showCollegeHeader={false}>
      <Card style={{
        padding: 20,
        marginBottom: 20,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderColor: 'transparent',
        borderRadius: 15,
        shadowOpacity: 0,
      }}>
        <TemplateSection title="📋 Required Columns (Minimally)">
          <Text style={uiStyles.body}>Your Excel file must include at least these columns:</Text>
          <TemplateTable headers={['Column Name', 'Data Type', 'Required', 'Description']} rows={requiredRows} />
        </TemplateSection>

        <TemplateSection title="🎨 Optional Columns (Enhanced Details)">
          <Text style={uiStyles.body}>Add these columns for complete student profiles with photos:</Text>
          <TemplateTable headers={['Column Name', 'Data Type', 'Example', 'Description']} rows={optionalRows} />
        </TemplateSection>

        <TemplateSection title="📖 Excel Column Names Supported">
          <Text style={uiStyles.body}>The system accepts various column name formats (case-insensitive):</Text>
          <TemplateNote><Text style={{ fontWeight: '700' }}>ID/Reg No: </Text>reg number, Reg Number, REG NUMBER, regno, RegNo, Reg No, reg no, register no, Register No, studentId, StudentId, id, ID</TemplateNote>
          <TemplateNote><Text style={{ fontWeight: '700' }}>Name: </Text>name, Name, NAME, studentName, StudentName, student name, Student, student, bname, Bname, BNAME</TemplateNote>
          <TemplateNote><Text style={{ fontWeight: '700' }}>Email: </Text>email, Email, EMAIL</TemplateNote>
          <TemplateNote><Text style={{ fontWeight: '700' }}>Phone: </Text>phone, Phone, PHONE</TemplateNote>
          <TemplateNote><Text style={{ fontWeight: '700' }}>Date of Birth: </Text>date of birth, Date of Birth, dob, Dob, DOB</TemplateNote>
          <TemplateNote><Text style={{ fontWeight: '700' }}>Address: </Text>address, Address, ADDRESS</TemplateNote>
          <TemplateNote><Text style={{ fontWeight: '700' }}>Parent Name: </Text>parent name, Parent Name, father name, Father Name, mother name, Mother name, guardian name</TemplateNote>
          <TemplateNote><Text style={{ fontWeight: '700' }}>Parent Phone: </Text>parent phone, Parent Phone, guardian phone</TemplateNote>
          <TemplateNote><Text style={{ fontWeight: '700' }}>Photo: </Text>photo, Photo, PHOTO, photo_url, Photo URL</TemplateNote>
        </TemplateSection>

        <TemplateSection title="📄 Sample Excel Data">
          <Text style={uiStyles.body}>Here's how your Excel file should look:</Text>
          <TemplateTable
            headers={['S.No', 'Reg Number', 'Name', 'Email', 'Phone', 'Date of Birth', 'Address', 'Parent Name', 'Parent Phone', 'Photo URL']}
            rows={[
              { values: ['1', 'CS2021001', 'Rajesh Kumar', 'rajesh.kumar@college.edu', '9876543210', '2003-05-15', '123 Gandhi Street, Chennai, Tamil Nadu', 'Kumar Rajan', '9876543211', 'https://randomuser.me/api/portraits/men/1.jpg'] },
              { values: ['2', 'CS2021002', 'Priya Sharma', 'priya.sharma@college.edu', '9876543212', '2003-08-22', '456 Anna Nagar, Chennai, Tamil Nadu', 'Sharma Ravi', '9876543213', 'https://randomuser.me/api/portraits/women/2.jpg'] },
              { values: ['3', 'CS2021003', 'Arjun Patel', 'arjun.patel@college.edu', '9876543214', '2004-03-10', '789 Nehru Road, Chennai, Tamil Nadu', 'Patel Vijay', '9876543215', ''] },
              { values: ['4', 'IT2021001', 'Sneha Reddy', 'sneha.reddy@college.edu', '9876543216', '2003-11-05', '321 Mount Road, Chennai, Tamil Nadu', 'Reddy Mohan', '9876543217', ''] },
            ]}
          />
          <TemplateNote tone="success">
            💡 Tip: photo URLs may use randomuser.me/portraits/men/{'{number}'}.jpg, randomuser.me/portraits/women/{'{number}'}.jpg, or ui-avatars.com/api/?name=Rajesh+Kumar&size=200.
          </TemplateNote>
        </TemplateSection>

        <TemplateSection title="🚀 How to Upload">
          <Text style={{ ...uiStyles.body, lineHeight: 25 }}>
            Step-by-Step Process:{'\n'}
            1. Download the Template (optional but recommended){'\n'}
            2. Fill in the Excel data: include S.No, Reg Number, and Name; add optional columns as needed; save the file.{'\n'}
            3. Go to the Admin Panel → Students Data.{'\n'}
            4. Choose Upload Excel.{'\n'}
            5. Select your Department and Year.{'\n'}
            6. Choose your Excel file and upload it.{'\n'}
            7. Review the upload result.
          </Text>
          <TemplateNote tone="warning">
            ⚠️ Important Notes: Department and Year are selected in the upload form, not in Excel. Register numbers must be unique within department/year. Photo URLs must be publicly accessible. Existing students in the same department/year may be updated.
          </TemplateNote>
          <TemplateNote tone="success">
            ✅ After Upload: Students appear in Students Data; photos display as circular thumbnails; use View Details to see full profiles; data can be searched and filtered.
          </TemplateNote>
        </TemplateSection>

        <TemplateSection title="📥 Download Resources">
          <Text style={uiStyles.body}>Template Download:</Text>
          <Button
            title="📋 Download Template (PDF)"
            tone="green"
            onPress={() => Alert.alert('Template guide', 'This page is the template guide. Create your Excel file using the column names shown above.')}
          />
          <Text style={uiStyles.muted}>Use the column names shown in the sample table above when creating your Excel file.</Text>
        </TemplateSection>

        <TemplateSection title="🔄 Quick Navigation">
          <Button title="📤 Upload Excel File" tone="green" onPress={() => navigation.navigate('ExcelUpload')} />
          <Button title="📊 View Students Data" tone="clear" onPress={() => navigation.navigate('Students')} />
          <Button title="🏠 Back to Dashboard" tone="clear" onPress={() => navigation.navigate('Dashboard')} />
        </TemplateSection>

        <TemplateSection title="❓ Common Issues">
          <TemplateNote tone="warning">Q: Why isn't my photo showing? A: The photo URL must be publicly accessible and must not require login or CORS restrictions.</TemplateNote>
          <TemplateNote tone="warning">Q: How do I add photos for existing students? A: Open Students Data, view the student details, and use the edit/photo functionality if available, or re-upload with photo URLs.</TemplateNote>
          <TemplateNote tone="warning">Q: Can I use base64 images for photos? A: Yes. Use a data:image/jpeg;base64,... URL.</TemplateNote>
          <TemplateNote tone="warning">Q: What happens if I upload duplicate register numbers? A: Existing records are updated instead of creating duplicates; an existing serial number is preserved.</TemplateNote>
        </TemplateSection>
      </Card>
    </Page>
  );
}

export function ReportsScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Reports'>>();
  const { user } = useSession();
  const daily = Boolean(route.params?.daily);
  const overview = Boolean(route.params?.overview);
  const periods = Boolean(route.params?.periods);
  const canViewDaily = user?.role === 'admin' || user?.role === 'staff';
  const [date, setDate] = useState(todayInIndia());
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [program, setProgram] = useState(user?.program === 'PG' ? 'PG' : daily ? 'ALL' : 'UG');
  const [department, setDepartment] = useState(user?.department || 'Computer Science');
  const [year, setYear] = useState(user?.year && user.year !== 'All' ? user.year : '1');
  const [classId, setClassId] = useState(user?.classId || 'CS1');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [periodSummary, setPeriodSummary] = useState<PeriodReportSummary[]>([]);
  const [overviewSummary, setOverviewSummary] = useState<{ departments: number; classes: number; students: number; percentage: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (daily && user && !canViewDaily) {
      setError('Daily reports are available to Admin and Staff accounts.');
    }
  }, [daily, user, canViewDaily]);

  async function generate() {
    setLoading(true);
    setError('');
    setRows([]);
    setPeriodSummary([]);
    setOverviewSummary(null);
    setGenerated(false);
    try {
      if (periods) {
        const scope = user?.role === 'admin' ? { department, year, program, classId } : {};
        const response = await api.get('/attendance/periods/report', { params: { ...scope, from, to } });
        const report = (response.data.report || []) as Array<Record<string, unknown>>;
        setHeaders(['S.No.', 'Register Number', 'Student Name', 'Periods Recorded', 'Present', 'Absent', 'Attendance']);
        setRows(report.map((item) => ({
          'S.No.': item.serial,
          'Register Number': item.studentId,
          'Student Name': item.studentName,
          'Periods Recorded': item.totalPeriods,
          Present: item.present,
          Absent: item.absent,
          Attendance: `${item.percentage}%`,
        })));
        setPeriodSummary(response.data.periodSummary || []);
      } else if (daily) {
        if (user?.role === 'staff') {
          const response = await api.get('/attendance/periods/report', { params: { from: date, to: date } });
          const summaries = (response.data.periodSummary || []) as PeriodReportSummary[];
          const summaryByPeriod = new Map<number, PeriodReportSummary>();
          summaries.forEach((summary) => summaryByPeriod.set(summary.period, summary));
          setHeaders(['Period', 'Time', 'Status', 'Present', 'Absent', 'Absent Students']);
          setRows(Object.entries(periodAttendanceSchedule).map(([period, window]) => {
            const summary = summaryByPeriod.get(Number(period));
            const absentStudents = summary?.absentStudents?.map((student) => `${student.studentId} · ${student.studentName}`).join('\n');
            return {
              Period: period,
              Time: window.label,
              Status: summary?.records ? 'Recorded' : 'Not recorded',
              Present: summary?.present || 0,
              Absent: summary?.absent || 0,
              'Absent Students': summary?.records
                ? absentStudents || (summary.absent ? 'List unavailable' : 'None')
                : 'Not recorded',
            };
          }));
        } else {
          const response = await api.get('/reports/daily', {
            params: { date, ...(user?.role === 'admin' ? { program: program === 'ALL' ? undefined : program } : {}) },
          });
          const report = (response.data.reportData || []) as Array<Record<string, unknown>>;
          setHeaders(['Class', 'Department', 'Present', 'Absent', 'Attendance', 'Total Students']);
          setRows(report.map((item) => ({
            Class: item.classYear, Department: item.department, Present: item.present,
            Absent: item.absent, Attendance: item.percentage, 'Total Students': item.totalStudents,
          })));
        }

      } else if (overview) {
        const studentResponse = await api.get('/students');
        const students = (studentResponse.data.students || []) as Student[];
        const classes = new Map<string, { department: string; year: string; program: string; classId: string }>();
        students.forEach((student) => {
          const scope = {
            department: student.department,
            year: String(student.year),
            program: student.program,
            classId: student.classId || `${student.program === 'PG' ? 'PGCS' : 'CS'}${student.year}`,
          };
          classes.set(`${scope.department}:${scope.program}:${scope.year}:${scope.classId}`, scope);
        });
        const classReports = await Promise.all([...classes.values()].map(async (scope) => {
          const response = await api.get('/reports/attendance', { params: { ...scope, from, to } });
          return { scope, data: response.data as { report?: Array<Record<string, unknown>>; totalStudents?: number } };
        }));
        const allRows = classReports.flatMap(({ scope, data }) => (data.report || []).map((item) => ({
          Department: scope.department,
          Class: scope.classId,
          'Register Number': item.studentId,
          'Student Name': item.studentName,
          'Total Days': item.totalDays,
          Present: item.present,
          Absent: item.absent,
          Percentage: `${item.percentage}%`,
        })));
        const presentTotal = allRows.reduce((sum, item) => sum + Number(item.Present || 0), 0);
        const absentTotal = allRows.reduce((sum, item) => sum + Number(item.Absent || 0), 0);
        setHeaders(['Department', 'Class', 'Register Number', 'Student Name', 'Total Days', 'Present', 'Absent', 'Percentage']);
        setRows(allRows);
        setOverviewSummary({
          departments: new Set([...classes.values()].map((item) => item.department)).size,
          classes: classes.size,
          students: classReports.reduce((sum, item) => sum + Number(item.data.totalStudents || 0), 0),
          percentage: presentTotal + absentTotal ? Math.round((presentTotal / (presentTotal + absentTotal)) * 100) : 0,
        });
      } else {
        const response = await api.get('/reports/attendance', { params: { department, year, program, classId, from, to } });
        const report = (response.data.report || []) as Array<Record<string, unknown>>;
        setHeaders(['S.No.', 'Register Number', 'Student Name', 'Total Days', 'Present', 'Absent', 'Percentage']);
        setRows(report.map((item) => ({
          'S.No.': item.serial, 'Register Number': item.studentId, 'Student Name': item.studentName,
          'Total Days': item.totalDays, Present: item.present, Absent: item.absent, Percentage: `${item.percentage}%`,
        })));
      }
      setGenerated(true);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (generated) void generate();
    });
    return unsubscribe;
  }, [navigation, generated, daily, periods, overview, user, date, from, to, program, department, year, classId]);

  async function exportExcel() {
    try {
      const prefix = periods ? 'Period_Attendance' : daily ? 'Daily_Attendance' : overview ? 'Admin_Attendance_Overview' : 'Attendance_Report';
      await shareSpreadsheet(`${prefix}_${today()}.xlsx`, rows);
    } catch (reason) { setError(getErrorMessage(reason)); }
  }

  async function exportPdf() {
    try {
      const title = periods ? `Period Attendance Report · ${from} to ${to}` :
        daily ? `Daily Attendance Report · ${date}` :
          overview ? `Admin Attendance Report · ${from} to ${to}` : `Attendance Report · ${from} to ${to}`;
      await sharePdf(title, headers, rows.map((row) => headers.map((header) => row[header])));
    } catch (reason) { setError(getErrorMessage(reason)); }
  }

  return (
    <Page title={periods ? 'Period Attendance Report' : daily ? 'Daily Attendance Report' : overview ? 'Admin Attendance Report - Overview' : 'Detailed Attendance Report'}>
      <Card>
        {daily ? (
          <>
            <Field label="Report date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
            {user?.role === 'admin' && <ChoiceRow label="Programme" options={['ALL', 'UG', 'PG']} value={program} onChange={setProgram} />}
          </>
        ) : overview ? (
          <>
            <Field label="From date (YYYY-MM-DD)" value={from} onChangeText={setFrom} />
            <Field label="To date (YYYY-MM-DD)" value={to} onChangeText={setTo} />
          </>
        ) : (
          <>
            {user?.role === 'admin' && <ChoiceRow label="Department" options={departments} value={department} onChange={(value) => { setDepartment(value); setClassId(getClassId(value, program, year)); }} />}
            {user?.role === 'admin' && <ChoiceRow label="Programme" options={['UG', 'PG']} value={program === 'ALL' ? 'UG' : program} onChange={(value) => { setProgram(value); setClassId(getClassId(department, value, '1')); setYear('1'); }} />}
            {user?.role === 'admin' && <ChoiceRow label="Year" options={program === 'PG' ? ['1', '2'] : ['1', '2', '3']} value={year} onChange={(value) => { setYear(value); setClassId(getClassId(department, program, value)); }} />}
            {user?.role === 'admin' && <ChoiceRow label="Class" options={getClassOptions(department, program)} value={classId} onChange={(value) => { setClassId(value); setYear(value.slice(-1)); }} />}
            <Field label="From date (YYYY-MM-DD)" value={from} onChangeText={setFrom} />
            <Field label="To date (YYYY-MM-DD)" value={to} onChangeText={setTo} />
          </>
        )}
        <Button title={loading ? 'Generating…' : 'Generate Report'} onPress={() => void generate()} disabled={loading || (daily && !canViewDaily)} />
        <Notice tone="error">{error}</Notice>
        {loading ? <Loading /> : rows.length > 0 || overviewSummary || (periods && generated) ? (
          <>
            <Text style={uiStyles.body}>Rows: {rows.length}</Text>
            {periodSummary.map((summary) => (
              <View key={summary.period} style={uiStyles.item}>
                <Text style={uiStyles.body}>
                  Period {summary.period}: {summary.records} records · Present {summary.present} · Absent {summary.absent} · {summary.percentage}%
                </Text>
              </View>
            ))}
            {overviewSummary && (
              <View style={uiStyles.item}>
                <Text style={uiStyles.body}>Departments: {overviewSummary.departments}</Text>
                <Text style={uiStyles.body}>Classes: {overviewSummary.classes}</Text>
                <Text style={uiStyles.body}>Total Students: {overviewSummary.students}</Text>
                <Text style={uiStyles.body}>Overall Attendance: {overviewSummary.percentage}%</Text>
              </View>
            )}
            {user?.role === 'admin' && rows.length > 0 && <Button title="Download / Share PDF" tone="green" onPress={() => void exportPdf()} />}
            {user?.role === 'admin' && rows.length > 0 && <Button title="Download / Share Excel" tone="purple" onPress={() => void exportExcel()} />}
            {overviewSummary && rows.length === 0 && <Notice>No student attendance rows are available for this period.</Notice>}
            {periods && rows.length === 0 && (
              <Notice>
                No period attendance records were found for {classId} from {from} to {to}. Check the date range and confirm attendance was submitted in Period Attendance mode.
              </Notice>
            )}
            {rows.map((row, index) => (
              <View key={index} style={uiStyles.item}>
                {headers.map((header) => <Text key={header} style={uiStyles.body}>{header}: {String(row[header] ?? '')}</Text>)}
              </View>
            ))}
          </>
        ) : <Text style={uiStyles.muted}>Generate a report to view its results.</Text>}
      </Card>
    </Page>
  );
}

export function DeleteDataScreen() {
  const [department, setDepartment] = useState('Computer Science');
  const [program, setProgram] = useState('UG');
  const [year, setYear] = useState('1');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function preview() {
    setError('');
    setSummary('');
    try {
      const response = await api.get('/reports/class/summary', { params: { department, program, year } });
      setSummary(`${response.data.studentCount} students · ${response.data.attendanceCount} attendance records`);
    } catch (reason) { setError(getErrorMessage(reason)); }
  }

  function deleteClass() {
    if (!summary) {
      setError('Preview the class data before deleting.');
      return;
    }
    Alert.alert('Delete class data', `Permanently delete data for ${department}, ${program}, year ${year}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          void (async () => {
            setBusy(true);
            setError('');
            try {
              const response = await api.delete('/reports/class', { data: { department, program, year } });
              setSummary(response.data.message || 'Class data deleted.');
            } catch (reason) { setError(getErrorMessage(reason)); }
            finally { setBusy(false); }
          })();
        }
      },
    ]);
  }

  return (
    <Page title="Delete Student Data">
      <Card>
        <ChoiceRow label="Department" options={departments} value={department} onChange={setDepartment} />
        <ChoiceRow label="Programme" options={['UG', 'PG']} value={program} onChange={(value) => { setProgram(value); setYear('1'); }} />
        <ChoiceRow label="Year" options={program === 'PG' ? ['1', '2'] : ['1', '2', '3']} value={year} onChange={setYear} />
        <Button title="Preview Students and Attendance" onPress={() => void preview()} />
        {summary ? <Notice>{summary}</Notice> : null}
        <Notice tone="error">{error}</Notice>
        <Button title={busy ? 'Deleting…' : 'Delete Class Data'} tone="red" onPress={deleteClass} disabled={busy} />
      </Card>
    </Page>
  );
}

type StaffAccount = {
  _id?: string;
  id?: string;
  username: string;
  name?: string;
  email?: string;
  role: 'staff';
  department: string;
  program?: 'UG' | 'PG' | 'All';
  year?: string;
  status?: string;
};

export function StaffManagementScreen() {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [editingId, setEditingId] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [department, setDepartment] = useState('Computer Science');
  const [program, setProgram] = useState<'UG' | 'PG' | 'All'>('UG');
  const [year, setYear] = useState('All');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/auth/staff');
      setStaff((response.data.staff || []) as StaffAccount[]);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function clearForm() {
    setEditingId('');
    setUsername('');
    setEmail('');
    setPassword('');
    setDepartment('Computer Science');
    setProgram('UG');
    setYear('All');
  }

  function editAccount(account: StaffAccount) {
    setEditingId(account._id || account.id || '');
    setUsername(account.username);
    setEmail(account.email || '');
    setPassword('');
    setDepartment(account.department);
    setProgram(account.program || 'UG');
    setYear(account.year || 'All');
    setMessage('');
  }

  async function save() {
    if (!username.trim() || (!editingId && !password)) {
      setError('Username and a password for new accounts are required.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        username: username.trim(),
        email: email.trim(),
        department,
        program,
        year,
        ...(password ? { password } : {}),
      };
      const response = editingId
        ? await api.put(`/auth/staff/${encodeURIComponent(editingId)}`, payload)
        : await api.post('/auth/staff', payload);
      setMessage(response.data.message || 'Staff account saved.');
      clearForm();
      await load();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const years = program === 'PG' ? ['All', '1', '2'] : ['All', '1', '2', '3'];

  return (
    <Page title="Staff Management">
      <Card>
        <Text style={uiStyles.heading}>{editingId ? 'Edit Staff Account' : 'Create Staff Account'}</Text>
        <Field label="Username *" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Field
          label={editingId ? 'New password (leave blank to keep current password)' : 'Password *'}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />
        <ChoiceRow label="Department" options={departments} value={department} onChange={setDepartment} />
        <ChoiceRow
          label="Programme"
          options={['UG', 'PG', 'All']}
          value={program}
          onChange={(value) => {
            setProgram(value as 'UG' | 'PG' | 'All');
            setYear('All');
          }}
        />
        <ChoiceRow label="Year" options={years} value={year} onChange={setYear} />
        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{message}</Notice>
        <Row>
          <Button title={busy ? 'Saving…' : editingId ? 'Save Changes' : 'Create Staff'} onPress={() => void save()} disabled={busy} />
          {editingId ? <Button title="Cancel" tone="clear" onPress={clearForm} disabled={busy} /> : null}
          <Button title="Refresh" tone="clear" onPress={() => void load()} disabled={loading || busy} />
        </Row>
      </Card>
      <Card>
        <Text style={uiStyles.heading}>Staff Accounts</Text>
        {loading ? <Loading /> : staff.length === 0 ? <Notice>No staff accounts found.</Notice> : staff.map((account) => (
          <View key={account._id || account.id || account.username} style={uiStyles.item}>
            <Text style={uiStyles.body}>{account.name || account.username}</Text>
            <Text style={uiStyles.muted}>
              {account.username} · {account.department} · {account.program || 'UG'} · Year {account.year || 'All'} · {account.status || 'active'}
            </Text>
            {account.email ? <Text style={uiStyles.muted}>{account.email}</Text> : null}
            <Button title="Edit Staff Account" compact onPress={() => editAccount(account)} />
          </View>
        ))}
      </Card>
    </Page>
  );
}

type NotificationItem = {
  _id: string;
  studentId: string;
  studentName: string;
  attendanceDate: string;
  classId: string;
  eventType: string;
  status: string;
  failureReason?: string;
  parentPhoneMasked?: string;
  canRetry?: boolean;
};

export function NotificationsScreen() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [status, setStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [classId, setClassId] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/notifications', {
        params: {
          ...(status === 'all' ? {} : { status }),
          ...(classId === 'all' ? {} : { classId }),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        }
      });
      setItems((response.data.notifications || []) as NotificationItem[]);
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function retry(item: NotificationItem) {
    setBusyId(item._id);
    setError('');
    try {
      const response = await api.post(`/notifications/${item._id}/retry`);
      Alert.alert('Notification retry', response.data.message || 'Retry processed.');
      await load();
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusyId(''); }
  }

  return (
    <Page title="Parent SMS Notification History">
      <Card>
        <ChoiceRow label="Class" options={['all', 'CS1', 'CS2', 'CS3', 'PGCS1', 'PGCS2']} value={classId} onChange={setClassId} />
        <ChoiceRow label="Status" options={['all', 'sent', 'delivered', 'failed', 'skipped']} value={status} onChange={setStatus} />
        <Field label="From date (YYYY-MM-DD)" value={dateFrom} onChangeText={setDateFrom} />
        <Field label="To date (YYYY-MM-DD)" value={dateTo} onChangeText={setDateTo} />
        <Button title="Apply Filters / Refresh" onPress={() => void load()} />
        <Notice tone="error">{error}</Notice>
        {loading ? <Loading /> : items.length === 0 ? <Notice>No notifications found.</Notice> : items.map((item) => (
          <View key={item._id} style={uiStyles.item}>
            <Text style={uiStyles.body}>{item.studentName} · {item.studentId}</Text>
            <Text style={uiStyles.muted}>{item.classId} · {item.attendanceDate} · {item.eventType} · {item.status.toUpperCase()}</Text>
            {item.parentPhoneMasked ? <Text style={uiStyles.muted}>Parent: {item.parentPhoneMasked}</Text> : null}
            {item.failureReason ? <Text style={uiStyles.muted}>{item.failureReason}</Text> : null}
            {item.canRetry && <Button title={busyId === item._id ? 'Retrying…' : 'Retry Failed Notification'} tone="green" compact onPress={() => void retry(item)} disabled={Boolean(busyId)} />}
          </View>
        ))}
      </Card>
    </Page>
  );
}

type Message = {
  _id: string;
  message: string;
  senderRole: string;
  senderName: string;
  createdAt: string;
};

export function MessagesScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'Messages'>>();
  const { user } = useSession();
  const requestId = route.params?.requestId;
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!requestId) {
        const response = user?.role === 'admin'
          ? await api.get('/student-requests/all')
          : await api.get('/student-requests/my-requests');
        setRequests((response.data.requests || []) as RequestItem[]);
      } else {
        const response = await api.get(`/messages/${requestId}`);
        setMessages((response.data.messages || []) as Message[]);
      }
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }, [requestId, user?.role]);

  useEffect(() => { void load(); }, [load]);

  async function send() {
    if (!requestId || !text.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/messages/${requestId}`, { message: text.trim() });
      setText('');
      await load();
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  }

  return (
    <Page title={requestId ? `Messages · ${route.params?.title || 'Request'}` : 'Staff ↔ Admin Messages'}>
      <Card>
        <Button title="Refresh" tone="clear" onPress={() => void load()} />
        <Notice tone="error">{error}</Notice>
        {loading ? <Loading /> : requestId ? (
          <>
            {messages.map((message) => (
              <View key={message._id} style={[uiStyles.item, { alignItems: message.senderRole === user?.role ? 'flex-end' : 'flex-start' }]}>
                <Text style={uiStyles.muted}>{message.senderName} · {new Date(message.createdAt).toLocaleString()}</Text>
                <Text style={uiStyles.body}>{message.message}</Text>
              </View>
            ))}
            <Field label="Message (up to 2000 characters)" value={text} onChangeText={setText} multiline maxLength={2000} />
            <Button title={busy ? 'Sending…' : 'Send'} onPress={() => void send()} disabled={busy || !text.trim()} />
          </>
        ) : requests.length === 0 ? <Notice>No registration-request conversations found.</Notice> : requests.map((item) => (
          <View key={item._id} style={uiStyles.item}>
            <Text style={uiStyles.body}>{item.studentName} · {item.studentRegisterNumber || item.studentId}</Text>
            <Text style={uiStyles.muted}>{item.status} · {item.requestedByName || item.requestedBy || ''}</Text>
            <Button title="Open Conversation" compact onPress={() => navigation.navigate('Messages', { requestId: item._id, title: item.studentName })} />
          </View>
        ))}
      </Card>
    </Page>
  );
}
