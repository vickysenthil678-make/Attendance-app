// Server-side class assignments for the dedicated UG and PG logins.
// Passwords are stored as bcrypt hashes in the User collection, never here.
const PROGRAMME_ACCOUNTS = Object.freeze({
    ugcs1: Object.freeze({ program: 'UG', year: '1', classId: 'CS1', department: 'Computer Science' }),
    ugcs2: Object.freeze({ program: 'UG', year: '2', classId: 'CS2', department: 'Computer Science' }),
    ugcs3: Object.freeze({ program: 'UG', year: '3', classId: 'CS3', department: 'Computer Science' }),
    pgcs1: Object.freeze({ program: 'PG', year: '1', classId: 'PGCS1', department: 'Computer Science' }),
    pgcs2: Object.freeze({ program: 'PG', year: '2', classId: 'PGCS2', department: 'Computer Science' })
});

module.exports = { PROGRAMME_ACCOUNTS };
