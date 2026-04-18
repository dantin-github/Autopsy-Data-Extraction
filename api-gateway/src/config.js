'use strict';

const path = require('path');

require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const port = Number(process.env.PORT) || 3000;
const rawSecret = process.env.SESSION_SECRET;
const sessionSecret = rawSecret != null ? String(rawSecret).trim() : '';

if (!sessionSecret) {
  const err = new Error(
    'SESSION_SECRET is required: set a strong random value in .env (see .env.example)'
  );
  err.code = 'CONFIG_SESSION_SECRET';
  throw err;
}

const usersFilePath = process.env.USERS_FILE
  ? path.resolve(process.cwd(), process.env.USERS_FILE)
  : path.join(__dirname, '..', 'data', 'users.json');

module.exports = {
  nodeEnv,
  port,
  sessionSecret,
  usersFilePath
};
