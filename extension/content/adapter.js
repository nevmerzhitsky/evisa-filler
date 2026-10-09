import {readScalarText, writeScalarText} from './scalar-text-access.js';
import {readCalendarDate, writeCalendarDate} from './calendar-field-access.js';
import {isPersonalFormUrl} from '../shared/route.js';
import {readBirthCalendar, writeBirthCalendar, prepareBirthCalendar} from './birth-calendar-access.js';
import {readNumericField, writeNumericField} from './numeric-field-access.js';
import {readRadioField, writeRadioField} from './radio-field-access.js';
import {readFixedSelect, writeFixedSelect} from './fixed-select-field-access.js';
import {readAddressField, writeAddressField} from './address-field-access.js';
import {createImageFieldAccess} from './image-field-access.js';
import {readRepeatedList,replaceRepeatedList} from './repeated-list-access.js';
import {LIST_CONTROLS} from '../shared/contract.js';
import {checkResidenceCommitment} from './residence-commitment.js';
import {readExportInput} from './form-export.js';

const textPaths = new Set([
  'personal.surname','personal.givenNames','personal.identityNumber','personal.email','personal.confirmEmail',
  'personal.religion','personal.placeOfBirth','passport.number','passport.placeOfIssue',
  'contact.permanentAddress','contact.mailingAddress','contact.phone','contact.emergency.name',
  'contact.emergency.address','contact.emergency.phone','contact.emergency.relationship',
  'occupation.description','occupation.organization','occupation.position','occupation.address','occupation.phone','trip.phone',
  'passport.typeDetails','trip.purposeDetails','expenses.insuranceDetails',
  'expenses.sponsor.name','expenses.sponsor.address','expenses.sponsor.phone'
]);
const datePaths = new Set(['passport.dateOfIssue','passport.dateOfExpiry','visa.validFrom','visa.validTo','trip.intendedEntryDate']);
const birthPaths = new Set(['personal.dateOfBirth','personal.yearOfBirth']);
const numericPaths = new Set(['trip.durationDays','expenses.estimatedAmount']);
const selectPaths = new Set(['personal.sex','occupation.category','trip.purpose','expenses.payer','expenses.hasInsurance','expenses.paymentMethod']);
const choicePaths = new Set(['personal.nationality','passport.type','trip.entryCheckpoint','trip.exitCheckpoint','trip.province','trip.ward']);
const radioPaths = new Set(['visa.entryType','personal.hasUsedOtherPassports','personal.hasOtherNationalities',
  'personal.hasViolations','passport.hasOtherValidPassports','trip.hasVietnamContacts',
  'trip.hasVisitedWithinLastYear','trip.hasRelativesInVietnam']);
const fail = code => Object.assign(new Error(code), {code});

export function isSupportedRoute(window, document = window.document) {
  try {
    return window.top === window && window.document === document && isPersonalFormUrl(window.location.href);
  } catch {return false;}
}

// These labels were observed on the English form even when <html lang> was not
// English. Native identities also prevent duplicate IDs from passing the probe.
function formSignature(document, complete = true) {
  try {
    const realm = document.defaultView;
    const getter = (proto, name) => Object.getOwnPropertyDescriptor(proto, name)?.get;
    const id = getter(realm.Element.prototype, 'id');
    const type = getter(realm.HTMLInputElement.prototype, 'type');
    const labels = getter(realm.HTMLInputElement.prototype, 'labels');
    const control = getter(realm.HTMLLabelElement.prototype, 'control');
    const htmlFor = getter(realm.HTMLLabelElement.prototype, 'htmlFor');
    const text = getter(realm.Node.prototype, 'textContent');
    if ([id,type,labels,control,htmlFor,text].some(fn => typeof fn !== 'function')) return false;
    const all = [...document.querySelectorAll('[id]')];
    if (all.length > 1000) return false;
    const unique = key => {const matches = all.filter(node => id.call(node) === key);return matches.length === 1 ? matches[0] : null;};
    const native = (key, expectedType) => {
      const node = unique(key);
      return node instanceof realm.HTMLInputElement && node.ownerDocument === document && node.isConnected && type.call(node) === expectedType ? node : null;
    };
    for (const [key, caption] of [['basic_ttcnEmail','Email'], ['basic_ttcnConfirmEmail','Re-enter Email']]) {
      const input = native(key, 'text');
      if (!input || input.getClientRects().length === 0) return false;
      const associated = [...labels.call(input)];
      if (associated.length !== 1) return false;
      const label = associated[0];
      if (!(label instanceof realm.HTMLLabelElement) || control.call(label) !== input || htmlFor.call(label) !== key ||
        text.call(label).trim().replace(/\s+/g,' ').replace(/\s*\*$/,'').trim() !== caption) return false;
    }
    return !complete || Boolean(native('basic_ttcnNgayThangNamSinhStr','text') && native('basic_anhMat','file') && native('basic_anhHoChieu','file'));
  } catch {return false;}
}

export function createAdapter({window, document = window.document}) {
  const images=createImageFieldAccess(document);
  function scoped(ctx) {
    const assertCurrent = () => {
      if (ctx?.signal?.aborted) throw fail('cancelled');
      try {if (typeof ctx?.assertCurrent !== 'function' || ctx.assertCurrent() === false) throw fail('document_lost');}
      catch {throw fail(ctx?.signal?.aborted ? 'cancelled' : 'document_lost');}
      if (!isSupportedRoute(window, document) || !formSignature(document,false)) throw fail('document_lost');
    };
    assertCurrent();
    return {...ctx, document, assertCurrent};
  }
  async function access(path, value, ctx, writing) {
    const context = scoped(ctx);
    if(Object.hasOwn(LIST_CONTROLS,path)) return writing
      ? replaceRepeatedList(document,path,value,context)
      : readRepeatedList(document,path,context);
    let pair;
    if (textPaths.has(path)) pair = [readScalarText,writeScalarText];
    else if (datePaths.has(path)) pair = [readCalendarDate,writeCalendarDate];
    else if (birthPaths.has(path)) pair = [readBirthCalendar,writeBirthCalendar];
    else if (numericPaths.has(path)) pair = [readNumericField,writeNumericField];
    else if (radioPaths.has(path)) pair = [readRadioField,writeRadioField];
    else if (selectPaths.has(path)) pair = [readFixedSelect,writeFixedSelect];
    else if (path==='trip.address') pair = [readAddressField,writeAddressField];
    else if (choicePaths.has(path)) {
      try {
        const module=await import('./choice-field-access.js');
        context.assertCurrent();
        pair=[module.readChoiceField,module.writeChoiceField];
      } catch(error) {
        let code;try{code=error?.code;}catch{}
        if(['cancelled','document_lost'].includes(code))throw fail(code);
        if(writing)throw fail('unavailable');
        return {available:false,valid:false};
      }
    }
    if (!pair) {
      if (writing) throw fail('unavailable');
      return {available:false,valid:false};
    }
    try {
      const result = writing ? await pair[1](path,value,context) : await pair[0](path,context);
      context.assertCurrent();
      return result;
    } catch (error) {
      let code;try {code=error?.code;} catch {}
      if (code === 'cancelled' || code === 'document_lost') throw fail(code);
      if (writing) throw fail('unavailable');
      return {available:false,valid:false};
    }
  }
  return {
    sideEffects: {'visa.validFrom':['trip.intendedEntryDate','trip.durationDays'], 'visa.validTo':['trip.durationDays']},
    probe(ctx) {
      if (ctx?.signal?.aborted) throw fail('cancelled');
      ctx?.assertCurrent?.();
      return {supported:isSupportedRoute(window,document) && formSignature(document)};
    },
    readField: (path,ctx) => access(path,undefined,ctx,false),
    readExportField(path,ctx) {
      const context=scoped(ctx);
      return readExportInput(document,path,context)??access(path,undefined,context,false);
    },
    writeField: (path,value,ctx) => access(path,value,ctx,true),
    async prepareField(path,ctx) {
      const context=scoped(ctx);
      if (!birthPaths.has(path)) return {ok:true};
      try {const result=await prepareBirthCalendar(path,context);context.assertCurrent();return result;}
      catch(error) {let code;try{code=error?.code;}catch{}throw fail(['cancelled','document_lost'].includes(code)?code:'unavailable');}
    },
    replaceList(path,rows,ctx) {return replaceRepeatedList(document,path,rows,scoped(ctx));},
    attachImage(role,file,ctx) {return images.attachImage(role,file,scoped(ctx));},
    observeImages(ctx) {
      const context=scoped(ctx);
      return images.observeImages(context);
    },
    observeDialog(ctx) {return images.observeDialog(scoped(ctx));},
    finalize(ctx) {return checkResidenceCommitment(document,scoped(ctx));},
    dispose() {images.dispose();}
  };
}

