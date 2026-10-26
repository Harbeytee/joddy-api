import { answerFor, findCountry, questionKey, type Applicant, type Question } from './answers';

const ada: Applicant = {
  firstName: 'Ada',
  lastName: 'Okafor',
  email: 'ada@example.com',
  phone: '+44 7700 900123',
  city: 'London',
  country: 'United Kingdom',
  linkedinUrl: 'https://linkedin.com/in/ada',
  websiteUrl: null,
  workCountries: ['uk', 'Nigeria', 'Philippines'],
  noticePeriod: '1 month',
  salaryExpectation: null,
  saved: {},
};

const ask = (label: string, extra: Partial<Question> = {}) =>
  answerFor({ label, kind: 'text', required: true, options: [], ...extra }, ada);
const choose = (label: string, options: string[]) => ask(label, { kind: 'select', options });

describe('findCountry', () => {
  it.each([
    ['Lagos, Nigeria', 'nigeria'],
    ['authorized to work in the US?', 'united states'],
    ['the U.K.', 'united kingdom'],
    ['work with us', null],
    ['Tell us about yourself', null],
  ])('%p → %p', (text, expected) => {
    expect(findCountry(text)).toBe(expected);
  });
});

describe('answerFor', () => {
  it('fills contact details', () => {
    expect(ask('First Name*')).toBe('Ada');
    expect(ask('Last Name')).toBe('Okafor');
    expect(ask('Full name')).toBe('Ada Okafor');
    expect(ask('Email')).toBe('ada@example.com');
    expect(ask('Phone')).toBe('+44 7700 900123');
    expect(ask('Please feel free to provide the link to your LinkedIn Profile here.')).toBe(
      'https://linkedin.com/in/ada',
    );
    expect(ask('Location (City)')).toBe('London');
    expect(ask('Current location')).toBe('London, United Kingdom');
  });

  it('leaves optional details blank when the profile has none', () => {
    expect(ask('If you have a website, please provide the URL')).toBeNull();
    expect(ask('Preferred First Name', { required: false })).toBeNull();
  });

  it('answers work eligibility only for countries the applicant listed', () => {
    const yesNo = ['Yes', 'No'];
    expect(choose('Are you legally authorized to work in the United Kingdom?', yesNo)).toBe('Yes');
    expect(choose('Are you currently authorized to work in the United States?', yesNo)).toBe('No');
    expect(choose('Will you require visa sponsorship to work in the US?', yesNo)).toBe('Yes');
    expect(
      choose('Will you now or in the future require sponsorship to work in the UK?', yesNo),
    ).toBe('No');
  });

  it('refuses to guess when the question names no country', () => {
    expect(
      choose('Are you authorized to work in the country where this job is located?', ['Yes', 'No']),
    ).toBeNull();
    expect(choose('Will you require sponsorship to work with us?', ['Yes', 'No'])).toBeNull();
  });

  it('recognises countries the applicant typed that Joddy has no aliases for', () => {
    expect(
      choose('Do you currently have the right to work in the Philippines?', ['Yes', 'No']),
    ).toBe('Yes');
  });

  it('refuses to choose between several kinds of "yes"', () => {
    const options = [
      'Yes, I am a resident or citizen',
      'Yes, I have a current working visa and do not require sponsorship',
      'No, I will require sponsorship and a working visa',
    ];
    expect(choose('Do you currently have the right to work in the UK?', options)).toBeNull();
    expect(choose('Do you currently have the right to work in Canada?', options)).toBe(options[2]);
  });

  it('confirms minimum-age requirements up to 18', () => {
    const yesNo = ['Yes', 'No'];
    expect(
      choose(
        '1. For this job, you will need to be 16 years of age. Do you meet this requirement?',
        yesNo,
      ),
    ).toBe('Yes');
    expect(choose('Are you at least 18?', yesNo)).toBe('Yes');
    expect(choose('Are you over 21?', yesNo)).toBeNull();
  });

  it('declines voluntary demographic questions', () => {
    expect(choose('What is your gender?', ['Male', 'Female', 'Prefer not to say'])).toBe(
      'Prefer not to say',
    );
    expect(choose('Veteran status', ['I am a veteran', 'I don’t wish to answer'])).toBe(
      'I don’t wish to answer',
    );
    expect(choose('What is your age?', ['18-24', '25-34'])).toBeNull();
    expect(ask('Please describe your ethnicity')).toBeNull();
  });

  it('only accepts required privacy acknowledgements, never marketing', () => {
    const box = (label: string, required: boolean) => ask(label, { kind: 'checkbox', required });
    expect(box('I have read and agree to the privacy notice', true)).toBe('true');
    expect(box('I consent to retain my materials for future hiring purposes', false)).toBeNull();
    expect(box('I consent to joining the talent community', true)).toBeNull();
    expect(
      box(
        'Do you agree to allow Acme to contact you about job opportunities for up to 1 year? Recruiting Privacy Policy',
        true,
      ),
    ).toBeNull();
    expect(
      choose('I confirm that I have read and understood the Candidate Privacy Notice', ['Yes']),
    ).toBe('Yes');
    expect(
      choose('I consent to Acme contacting me in future to inform me of potential new roles', [
        'Yes',
        'No',
      ]),
    ).toBe('No');
  });

  it('keys questions the same way however they are numbered or marked', () => {
    expect(questionKey('2. What days/hours are you available?*')).toBe(
      questionKey('What days/hours are you available?'),
    );
  });

  it('reuses answers the applicant gave before, ahead of its own rules', () => {
    const withSaved = {
      ...ada,
      saved: {
        'what interests you most about this role': 'The mission.',
        'are you amenable with a hybrid work arrangement':
          'Yes, I am ok with a hybrid work arrangement',
      },
    };
    const q = (label: string, extra: Partial<Question> = {}) =>
      answerFor({ label, kind: 'textarea', required: true, options: [], ...extra }, withSaved);
    expect(q('What interests you most about this role?*')).toBe('The mission.');
    expect(
      q('Are you amenable with a hybrid work arrangement?', {
        kind: 'select',
        options: [
          'Yes, I am ok with a hybrid work arrangement',
          'No, I would prefer to work fully remotely',
        ],
      }),
    ).toBe('Yes, I am ok with a hybrid work arrangement');
    expect(
      q('Are you amenable with a hybrid work arrangement?', {
        kind: 'select',
        options: ['Yes', 'No'],
      }),
    ).toBeNull();
  });

  it('gives location autocompletes the city and country', () => {
    expect(ask('Location (City)', { kind: 'search' })).toBe('London, United Kingdom');
    expect(
      choose('What country are you currently a resident of?', ['Nigeria', 'United Kingdom']),
    ).toBe('United Kingdom');
    expect(choose('Country', ['United States +1', 'United Kingdom +44'])).toBe(
      'United Kingdom +44',
    );
  });

  it('says the applicant is outside the US when asked for a US state', () => {
    expect(
      choose(
        'If you are currently based in United States, please confirm your current state of residence.',
        ['I am not located in the USA currently', 'AL', 'AK'],
      ),
    ).toBe('I am not located in the USA currently');
  });

  it('leaves questions it does not understand to the applicant', () => {
    expect(ask('Home Address (please include city and state)')).toBeNull();
    expect(
      ask('What inspired you to pursue a career in engineering?', { kind: 'textarea' }),
    ).toBeNull();
    expect(
      choose('Do you currently live in the San Francisco Bay Area?', ['Yes', 'No']),
    ).toBeNull();
  });

  it('uses profile answers for notice period and source questions', () => {
    expect(ask('What is your notice period?')).toBe('1 month');
    expect(ask('What are your salary expectations?')).toBeNull();
    expect(choose('How did you hear about this job?', ['Referral', 'LinkedIn', 'Other'])).toBe(
      'Other',
    );
  });
});
