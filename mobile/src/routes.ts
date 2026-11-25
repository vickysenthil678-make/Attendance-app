import type { Student } from './types';

export type RootStackParamList = {
  SignIn: undefined;
  ClassSelect: undefined;
  Dashboard: undefined;
  Attendance: { mode?: 'daily' | 'period' } | undefined;
  Students: undefined;
  Staff: undefined;
  StudentForm: { student?: Student; department?: string; program?: 'UG' | 'PG'; year?: string; classId?: string } | undefined;
  Requests: undefined;
  RequestForm: undefined;
  ExcelUpload: undefined;
  ExcelTemplate: undefined;
  Reports: { daily?: boolean; overview?: boolean; periods?: boolean } | undefined;
  Notifications: undefined;
  DeleteData: undefined;
  Messages: { requestId?: string; title?: string } | undefined;
};
