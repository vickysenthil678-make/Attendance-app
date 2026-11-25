export type Role = 'admin' | 'staff';

export type User = {
  id?: string;
  _id?: string;
  username: string;
  name: string;
  email?: string;
  role: Role;
  department: string;
  program: 'UG' | 'PG' | 'All';
  year: string;
  classId?: string;
  status?: string;
};

export type Student = {
  _id: string;
  studentId: string;
  studentName: string;
  serial?: number;
  department: string;
  program: 'UG' | 'PG';
  year: string;
  academicYear?: string;
  classId?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
  parentName?: string;
  parentPhone?: string;
  parentRelationship?: string;
  gender?: string;
  umisId?: string;
  abcId?: string;
  dayScholarHosteller?: string;
  photo?: string;
  photoId?: string | null;
  parentSmsOptOut?: boolean;
};

export type RequestItem = {
  _id: string;
  studentName: string;
  studentId?: string;
  studentRegisterNumber?: string;
  department: string;
  program: 'UG' | 'PG';
  year?: string;
  academicYear?: string;
  classId?: string;
  section?: string;
  phone?: string;
  parentPhone?: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  requestedByName?: string;
  requestedBy?: string;
  reason?: string;
  rejectionReason?: string;
  adminRemarks?: string;
  isCompleted?: boolean;
  completedStudentId?: string;
};

export type AttendanceRecord = {
  studentId: string;
  studentName: string;
  status: 'present' | 'absent';
};
