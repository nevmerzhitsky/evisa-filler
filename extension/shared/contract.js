// Data metadata only. Site bundle names are research hints, never DOM selectors.
export const SCHEMA_VERSION = 1;
export const RECORDS = {
  previousPassports: { number: 'text', fullName: 'text', dateOfBirth: 'date', nationality: 'choice' },
  violations: { act: 'text', date: 'date', sanction: 'text', authority: 'text' },
  otherValidPassports: { type: 'choice', number: 'text', placeOfIssue: 'text', dateOfIssue: 'date', dateOfExpiry: 'date', typeDetails: 'text' },
  vietnamContacts: { name: 'text', phone: 'text', address: 'text', purpose: 'text' },
  previousVisits: { from: 'date', to: 'date', purpose: 'text' },
  relativesInVietnam: { fullName: 'text', dateOfBirth: 'date', nationality: 'choice', relationship: 'text', address: 'text' }
};
export const GROUPS = {
  personal: { surname:'text', givenNames:'text', dateOfBirth:'date', yearOfBirth:'year', sex:'choice', nationality:'choice', placeOfBirth:'text', religion:'text', identityNumber:'text', email:'text', hasOtherNationalities:'bool', otherNationalities:'choices', hasUsedOtherPassports:'bool', previousPassports:'records', hasViolations:'bool', violations:'records' },
  passport: { number:'text', type:'choice', typeDetails:'text', placeOfIssue:'text', dateOfIssue:'date', dateOfExpiry:'date', hasOtherValidPassports:'bool', otherValidPassports:'records' },
  visa: { entryType:'choice', validFrom:'date', validTo:'date' },
  contact: { permanentAddress:'text', mailingAddress:'text', phone:'text', emergency:{ name:'text', phone:'text', relationship:'text', address:'text' } },
  occupation: { category:'choice', description:'text', organization:'text', position:'text', address:'text', phone:'text' },
  trip: { purpose:'choice', purposeDetails:'text', intendedEntryDate:'date', durationDays:'positiveInteger', entryCheckpoint:'choice', exitCheckpoint:'choice', address:'text', province:'choice', ward:'choice', phone:'text', hasVietnamContacts:'bool', vietnamContacts:'records', hasVisitedWithinLastYear:'bool', previousVisits:'records', hasRelativesInVietnam:'bool', relativesInVietnam:'records' },
  expenses: { estimatedAmount:'number', hasInsurance:'bool', insuranceDetails:'text', payer:'choice', paymentMethod:'choice', sponsor:{ name:'text', address:'text', phone:'text' } }
};
export const LIST_CONTROLS = {
  'personal.otherNationalities':'personal.hasOtherNationalities',
  'personal.previousPassports':'personal.hasUsedOtherPassports',
  'personal.violations':'personal.hasViolations',
  'passport.otherValidPassports':'passport.hasOtherValidPassports',
  'trip.vietnamContacts':'trip.hasVietnamContacts',
  'trip.previousVisits':'trip.hasVisitedWithinLastYear',
  'trip.relativesInVietnam':'trip.hasRelativesInVietnam'
};
export const DEPENDENCIES = {
  'personal.confirmEmail':['personal.email'],
  'passport.typeDetails':['passport.type'], 'trip.purposeDetails':['trip.purpose'],
  'trip.ward':['trip.province'], 'expenses.paymentMethod':['expenses.payer'],
  'expenses.sponsor.name':['expenses.payer'], 'expenses.sponsor.address':['expenses.payer'],
  'expenses.sponsor.phone':['expenses.payer'], 'expenses.insuranceDetails':['expenses.hasInsurance'],
  ...Object.fromEntries(Object.entries(LIST_CONTROLS).map(([list, control]) => [list, [control]]))
};
export const CONTROLLING_FIELDS = [...Object.values(LIST_CONTROLS), 'personal.dateOfBirth','personal.yearOfBirth','passport.type','trip.purpose','trip.province','expenses.payer','expenses.hasInsurance'];
export const FIELDS = Object.freeze(Object.fromEntries(Object.entries(GROUPS).flatMap(([group, fields]) => Object.entries(fields).flatMap(([name,type]) => typeof type === 'object' ? Object.entries(type).map(([child, childType]) => [`${group}.${name}.${child}`, {type:childType}]) : [[`${group}.${name}`,{type}]]))));
