const assert = require('assert');
const User = require('../models/User');
const { createStaff, updateStaff } = require('../controllers/authController');

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

async function call(handler, req) {
    const res = response();
    await handler(req, res);
    return res;
}

async function runTests() {
    const originalFindOne = User.findOne;
    const originalCreate = User.create;
    let created;
    let updated;

    try {
        User.findOne = async () => null;
        User.create = async (value) => {
            created = { _id: 'staff-1', ...value };
            return created;
        };

        const createResponse = await call(createStaff, {
            body: {
                username: 'pgstaff',
                password: 'temporary-password',
                department: 'Computer Science',
                program: 'PG',
                year: 'All'
            }
        });
        assert.strictEqual(createResponse.statusCode, 201, 'admin can create a staff account');
        assert.strictEqual(created.program, 'PG', 'staff programme is saved');
        assert.strictEqual(createResponse.body.staff.program, 'PG', 'created programme is returned to the app');

        const allProgramResponse = await call(createStaff, {
            body: {
                username: 'allstaff',
                password: 'temporary-password',
                department: 'Computer Science',
                program: 'All',
                year: 'All'
            }
        });
        assert.strictEqual(allProgramResponse.statusCode, 201, 'All programme accounts are accepted');
        assert.strictEqual(created.program, 'All', 'All programme is stored using the schema enum value');

        const invalidCreate = await call(createStaff, {
            body: { username: 'invalid', password: 'temporary-password', program: 'UGX' }
        });
        assert.strictEqual(invalidCreate.statusCode, 400, 'unsupported programme is rejected');

        const staffAccount = {
            _id: 'staff-1',
            role: 'staff',
            username: 'pgstaff',
            department: 'Computer Science',
            program: 'UG',
            year: '1',
            email: '',
            async save() { updated = this; }
        };
        User.findOne = async () => staffAccount;
        const updateResponse = await call(updateStaff, {
            params: { id: 'staff-1' },
            body: { department: 'Computer Science', program: 'PG', year: '2' }
        });
        assert.strictEqual(updateResponse.statusCode, 200, 'admin can update a staff account');
        assert.strictEqual(updated.program, 'PG', 'updated programme is saved');
        assert.strictEqual(updateResponse.body.staff.program, 'PG', 'updated programme is returned to the app');

        const updateAllResponse = await call(updateStaff, {
            params: { id: 'staff-1' },
            body: { program: 'All' }
        });
        assert.strictEqual(updateAllResponse.statusCode, 200, 'All programme can be assigned when editing');
        assert.strictEqual(updated.program, 'All', 'All programme is normalized for the schema enum');

        console.log('Staff management tests passed.');
    } finally {
        User.findOne = originalFindOne;
        User.create = originalCreate;
    }
}

runTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
