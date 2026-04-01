require('dotenv').config();

module.exports = {
  drachtio: {
    host: process.env.DRACHTIO_HOST,
    port: process.env.DRACHTIO_PORT,
    secret: process.env.DRACHTIO_SECRET,
  },
  google: {
    apiKey: process.env.GOOGLE_API_KEY,
  },
  bookingFormUrl: process.env.BOOKING_FORM_URL,
  sip: {
    username: process.env.SIP_USERNAME,
    password: process.env.SIP_PASSWORD,
    domain: process.env.SIP_DOMAIN,
  },
};
