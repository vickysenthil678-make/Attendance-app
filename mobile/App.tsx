import React from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/session';
import { RootStackParamList } from './src/routes';
import {
  AttendanceScreen, DeleteDataScreen, ExcelTemplateScreen, ExcelUploadScreen, MessagesScreen,
  NotificationsScreen, ReportsScreen, RequestFormScreen, RequestsScreen,
  StaffManagementScreen, StudentFormScreen, StudentsScreen,
} from './src/WorkflowScreens';
import { ClassSelectScreen, DashboardScreen, SignInScreen } from './src/AuthScreens';
import { palette } from './src/ui';

const Stack = createNativeStackNavigator<RootStackParamList>();

function Navigation() {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.purple, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={palette.white} size="large" />
      </View>
    );
  }

  const classRequired = user?.role === 'staff' && (!user.classId || user.year === 'All');
  return (
    <NavigationContainer>
      <Stack.Navigator
        key={user ? `${user.role}:${user.classId || user.year}` : 'signed-out'}
        initialRouteName={!user ? 'SignIn' : classRequired ? 'ClassSelect' : 'Dashboard'}
        screenOptions={{
          headerShown: false,
          animation: 'none',
          gestureEnabled: true,
          contentStyle: { backgroundColor: palette.purple },
        }}
      >
        {!user ? (
          <Stack.Screen name="SignIn" component={SignInScreen} />
        ) : classRequired ? (
          <Stack.Screen name="ClassSelect" component={ClassSelectScreen} />
        ) : user.role === 'admin' ? (
          <>
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="Attendance" component={AttendanceScreen} />
            <Stack.Screen name="Students" component={StudentsScreen} />
            <Stack.Screen name="Staff" component={StaffManagementScreen} />
            <Stack.Screen name="StudentForm" component={StudentFormScreen} />
            <Stack.Screen name="Requests" component={RequestsScreen} />
            <Stack.Screen name="ExcelUpload" component={ExcelUploadScreen} />
            <Stack.Screen name="ExcelTemplate" component={ExcelTemplateScreen} />
            <Stack.Screen name="Reports" component={ReportsScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="DeleteData" component={DeleteDataScreen} />
            <Stack.Screen name="Messages" component={MessagesScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="Attendance" component={AttendanceScreen} />
            <Stack.Screen name="Students" component={StudentsScreen} />
            <Stack.Screen name="StudentForm" component={StudentFormScreen} />
            <Stack.Screen name="Requests" component={RequestsScreen} />
            <Stack.Screen name="RequestForm" component={RequestFormScreen} />
            <Stack.Screen name="ExcelUpload" component={ExcelUploadScreen} />
            <Stack.Screen name="ExcelTemplate" component={ExcelTemplateScreen} />
            <Stack.Screen name="Reports" component={ReportsScreen} />
            <Stack.Screen name="Messages" component={MessagesScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }} edges={['top', 'bottom']}>
        <SessionProvider>
          <Navigation />
        </SessionProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
