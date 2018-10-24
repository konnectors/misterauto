process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://12a934d948e84706b886845e07352747@sentry.cozycloud.cc/93'

const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  // debug: true,
  cheerio: true,
  json: false,
  jar: true
})
const formatDate = require('date-fns/format')

const baseUrl = 'https://www.mister-auto.com/moncompte/'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  let $ = await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  $ = await request(`${baseUrl}commandes.html`)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    identifiers: ['mister auto'],
    keys: ['id']
  })
}

function authenticate(username, password) {
  return signin({
    requestInstance: request,
    url: baseUrl,
    formSelector: '#login_form',
    formData: {
      'personnelle[email]': username,
      'personnelle[password]': password
    }
  })
}

function parseDocuments($) {
  const docs = scrape(
    $,
    {
      id: 'td:nth-child(2)',
      amount: {
        sel: 'td:nth-child(3)',
        parse: normalizePrice
      },
      date: {
        sel: 'td:nth-child(1)',
        parse: parseDate
      },
      fileurl: {
        sel: 'td:nth-child(6) a',
        attr: 'href'
      }
    },
    '#cmd_table tbody tr'
  )
  return docs.map(doc => ({
    ...doc,
    currency: '€',
    vendor: 'Mister Auto',
    filename: formatFileName(doc),
    metadata: {
      importDate: new Date(),
      version: 1
    }
  }))
}

function normalizePrice(price) {
  return parseFloat(price.replace('€', '').trim())
}

function parseDate(date) {
  let [day, time] = date.split(' ')
  time = time.replace('h', ':')
  day = day.split('/').reverse()
  const year = day.shift()
  day.push(year)
  day = day.join('/')
  return new Date(`${day} ${time}`)
}

function formatFileName(doc) {
  return `misterauto-${formatDate(doc.date, 'YYYY-MM-DD')}-${String(
    doc.amount
  ).replace('.', ',')}€.pdf`
}
