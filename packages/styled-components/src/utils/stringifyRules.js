// @flow
import Stylis from 'stylis/stylis.min';
import _insertRulePlugin from 'stylis-rule-sheet';
import type { Interpolation } from '../types';

const COMMENT_REGEX = /^\s*\/\/.*$/gm;

// NOTE: This stylis instance is only used to split rules from SSR'd style tags
const stylisSplitter = new Stylis({
  global: false,
  cascade: true,
  keyframe: false,
  prefix: false,
  compress: false,
  semicolon: true,
});

const stylis = new Stylis({
  global: false,
  cascade: true,
  keyframe: false,
  prefix: true,
  compress: false,
  semicolon: false, // NOTE: This means "autocomplete missing semicolons"
});

// Wrap `insertRulePlugin to build a list of rules,
// and then make our own plugin to return the rules. This
// makes it easier to hook into the existing SSR architecture

let parsingRules = [];

// eslint-disable-next-line consistent-return
const returnRulesPlugin = context => {
  if (context === -2) {
    const parsedRules = parsingRules;
    parsingRules = [];
    return parsedRules;
  }
};

const parseRulesPlugin = _insertRulePlugin(rule => {
  parsingRules.push(rule);
});

let _componentId: string;
let _selector: string;
let _selectorRegexp: RegExp;

const selfReferenceReplacer = (match, offset, string) => {
  if (
    // the first self-ref is always untouched
    offset > 0 &&
    // there should be at least two self-refs to do a replacement (.b > .b)
    string.slice(0, offset).indexOf(_selector) !== -1 &&
    // no consecutive self refs (.b.b); that is a precedence boost and treated differently
    string.slice(offset - _selector.length, offset) !== _selector
  ) {
    return `.${_componentId}`;
  }

  return match;
};

/**
 * When writing a style like
 *
 * & + & {
 *   color: red;
 * }
 *
 * The second ampersand should be a reference to the static component class. stylis
 * has no knowledge of static class so we have to intelligently replace the base selector.
 */
const selfReferenceReplacementPlugin = (context, _, selectors) => {
  if (context === 2 && selectors.length && selectors[0].lastIndexOf(_selector) > 0) {
    // eslint-disable-next-line no-param-reassign
    selectors[0] = selectors[0].replace(_selectorRegexp, selfReferenceReplacer);
  }
};

stylis.use([selfReferenceReplacementPlugin, parseRulesPlugin, returnRulesPlugin]);
stylisSplitter.use([parseRulesPlugin, returnRulesPlugin]);

export const splitByRules = (css: string): Array<string> => stylisSplitter('', css);

export default function stringifyRules(
  rules: Array<Interpolation>,
  selector: string,
  prefix: ?string,
  componentId: string = '&'
): Array<string> {
  let flatCSS = rules.join('').replace(COMMENT_REGEX, ''); // replace JS comments
  if (flatCSS.indexOf('/*') !== -1 && flatCSS.split('/*').length !== flatCSS.split('*/').length) {
    flatCSS += '*/'; // simplest / fastest way to not cause crashes due to unterminated css comments
  }

  const cssStr = selector && prefix ? `${prefix} ${selector} { ${flatCSS} }` : flatCSS;

  // stylis has no concept of state to be passed to plugins
  // but since JS is single=threaded, we can rely on that to ensure
  // these properties stay in sync with the current stylis run
  _componentId = componentId;
  _selector = selector;
  _selectorRegexp = new RegExp(`\\${_selector}\\b`, 'g');

  return stylis(prefix || !selector ? '' : selector, cssStr);
}
