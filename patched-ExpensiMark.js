import * as _ from 'underscore';
import Str from './str';
import * as Constants from './CONST';
import * as UrlPatterns from './Url';

const MARKDOWN_LINK_REGEX = new RegExp(`\\[([^\\][]*(?:\\[[^\\][]*][^\\][]*)*)]\\(${UrlPatterns.MARKDOWN_URL_REGEX}\\)(?![^<]*(<\\/pre>|<\\/code>))`, 'gi');
const MARKDOWN_IMAGE_REGEX = new RegExp(`\\!(?:\\[([^\\][]*(?:\\[[^\\][]*][^\\][]*)*)])?\\(${UrlPatterns.MARKDOWN_URL_REGEX}\\)(?![^<]*(<\\/pre>|<\\/code>))`, 'gi');

const SLACK_SPAN_NEW_LINE_TAG = '<span class="c-mrkdwn__br" data-stringify-type="paragraph-break" style="box-sizing: inherit; display: block; height: unset;"></span>';

export const ExpensiMark = {
    initializer() {
        /**
         * The list of regex replacements to do on a comment. Check the link regex is first so links are processed
         * before other delimiters
         *
         * @type {Object[]}
         */
        this.rules = [
            // Apply the emoji first avoid applying any other formatting rules inside of it
            {
                name: 'emoji',
                regex: Constants.CONST.REG_EXP.EMOJI_RULE,
                replacement: (match) => `<emoji>${match}</emoji>`,
            },

            /**
             * Apply the code-fence to avoid replacing anything inside of it that we're not supposed to
             * (aka any rule with the '(?![^<]*<\/pre>)' avoidance in it
             */
            {
                name: 'codeFence',

                // &#x60; is a backtick symbol we are matching on three of them before then after a new line character
                regex: /(&#x60;&#x60;&#x60;(?:\r\n|\n)?)((?:\s*?(?!(?:\r\n|\n)?&#x60;&#x60;&#x60;(?!&#x60;))[\S])+\s*?)((?=(?:\r\n|\n)?)&#x60;&#x60;&#x60;)/g,

                // We're using a function here to perform an additional replace on the content
                // inside the backticks because Android is not able to use <pre> tags and does
                // not respect whitespace characters at all like HTML does. We do not want to mess
                // with the new lines here since they need to be converted into <br>. And we don't
                // want to do this anywhere else since that would break HTML.
                // &nbsp; will create styling issues so use &#32;
                replacement: (match, __, textWithinFences) => {
                    const group = textWithinFences.replace(/(?:(?![\n\r])\s)/g, '&#32;');
                    return `<pre>${group}</pre>`;
                },
                rawInputReplacement: (match, __, textWithinFences) => {
                    const withinFences = match.replace(/(?:&#x60;&#x60;&#x60;)([\s\S]*?)(?:&#x60;&#x60;&#x60;)/g, '$1').replace(/<emoji>|<\/emoji>/g, '');
                    const group = textWithinFences.replace(/(?:(?![\n\r])\s)/g, '&#32;');
                    return `<pre data-code-raw="${withinFences}">${group}</pre>`;
                },
            },

            /**
             * Apply inline code-block to avoid applying any other formatting rules inside of it,
             * like we do for the multi-line code-blocks
             */
            {
                name: 'inlineCodeBlock',

                // Use the url escaped version of a backtick (`) symbol. Mobile platforms do not support lookbehinds,
                // so capture the first and third group and place them in the replacement.
                // but we should not replace backtick symbols if they include <pre> tags between them.
                regex: /(\B|_|)&#x60;(?:(?!(?:(?!&#x60;).)*?<pre>))(.*?\S.*?)&#x60;(\B|_|)(?!&#x60;|[^<]*<\/pre>)/g,
                replacement: (match, g1, g2, g3) => {
                    const regex = /^[&#x60;]+$/i;

                    // if content of the inline code block is only backtick symbols, we should not replace them with <code> tag
                    if (regex.test(g2)) {
                        return match;
                    }
                    return `${g1}<code>${g2}</code>${g3}`;
                },
            },

            /**
             * Converts markdown style links to anchor tags e.g. [Expensify](concierge@expensify.com)
             * We need to convert before the auto email link rule and the manual link rule since it will not try to
             * create a link from an existing anchor tag.
             */
            {
                name: 'email',
                process: (textToProcess, replacement, shouldKeepRawInput) => {
                    const regex = new RegExp(`(?!\\[\\s*\\])\\[([^[\\]]*)]\\((mailto:)?${Constants.CONST.REG_EXP.MARKDOWN_EMAIL}\\)`, 'gim');
                    return this.modifyTextForEmailLinks(regex, textToProcess, replacement, shouldKeepRawInput);
                },
                replacement: (match, g1, g2) => {
                    if (g1.match(Constants.CONST.REG_EXP.EMOJIS) || !g1.trim()) {
                        return match;
                    }
                    const label = g1.trim();
                    const href = `mailto:${g2}`;
                    const formattedLabel = label === href ? g2 : label;
                    return `<a href="${href}">${formattedLabel}</a>`;
                },
                rawInputReplacement: (match, g1, g2, g3) => {
                    if (g1.match(Constants.CONST.REG_EXP.EMOJIS) || !g1.trim()) {
                        return match;
                    }

                    const dataRawHref = g2 ? g2 + g3 : g3;
                    const href = `mailto:${g3}`;
                    return `<a href="${href}" data-raw-href="${dataRawHref}" data-link-variant="labeled">${g1}</a>`;
                },
            },

            {
                name: 'heading1',
                process: (textToProcess, replacement, shouldKeepRawInput = false) => {
                    const regexp = shouldKeepRawInput ? /^ *# ( *(?! )(?:(?!<pre>|\n|\r\n).)+)/gm : /^ *# +(?! )((?:(?!<pre>|\n|\r\n).)+)/gm;
                    return textToProcess.replace(regexp, replacement);
                },
                replacement: '<h1>$1</h1>',
            },

            /**
             * Converts markdown style images to img tags e.g. ![Expensify](https://www.expensify.com/attachment.png)
             * We need to convert before linking rules since they will not try to create a link from an existing img
             * tag.
             * Additional sanitization is done to the alt attribute to prevent parsing it further to html by later
             * rules.
             */
            {
                name: 'image',
                regex: MARKDOWN_IMAGE_REGEX,
                replacement: (match, g1, g2) => `<img src="${Str.sanitizeURL(g2)}"${g1 ? ` alt="${this.escapeAttributeContent(g1)}"` : ''} />`,
                rawInputReplacement: (match, g1, g2) =>
                    `<img src="${Str.sanitizeURL(g2)}"${g1 ? ` alt="${this.escapeAttributeContent(g1)}"` : ''} data-raw-href="${g2}" data-link-variant="${typeof g1 === 'string' ? 'labeled' : 'auto'}" />`,
            },

            /**
             * Converts markdown style links to anchor tags e.g. [Expensify](https://www.expensify.com)
             * We need to convert before the autolink rule since it will not try to create a link
             * from an existing anchor tag.
             */
            {
                name: 'link',
                process: (textToProcess, replacement) => this.modifyTextForUrlLinks(MARKDOWN_LINK_REGEX, textToProcess, replacement),
                replacement: (match, g1, g2) => {
                    if (g1.match(Constants.CONST.REG_EXP.EMOJIS) || !g1.trim()) {
                        return match;
                    }
                    return `<a href="${Str.sanitizeURL(g2)}" target="_blank" rel="noreferrer noopener">${g1.trim()}</a>`;
                },
                rawInputReplacement: (match, g1, g2) => {
                    if (g1.match(Constants.CONST.REG_EXP.EMOJIS) || !g1.trim()) {
                        return match;
                    }
                    return `<a href="${Str.sanitizeURL(g2)}" data-raw-href="${g2}" data-link-variant="labeled" target="_blank" rel="noreferrer noopener">${g1.trim()}</a>`;
                },
            },

            /**
             * Apply the hereMention first because the string @here is still a valid mention for the userMention regex.
             * This ensures that the hereMention is always considered first, even if it is followed by a valid
             * userMention.
             *
             * Also, apply the mention rule after email/link to prevent mention appears in an email/link.
             */
            {
                name: 'hereMentions',
                regex: /([a-zA-Z0-9.!$%&+/=?^`{|}_-]?)(@here)([.!$%&+/=?^`{|}_-]?)(?=\b)(?!([\w'#%+-]*@(?:[a-z\d-]+\.)+[a-z]{2,}(?:\s|$|@here))|((?:(?!<a).)+)?<\/a>|[^<]*(<\/pre>|<\/code>))/gm,
                replacement: (match, g1, g2, g3) => {
                    if (!Str.isValidMention(match)) {
                        return match;
                    }
                    return `${g1}<mention-here>${g2}</mention-here>${g3}`;
                },
            },

            /**
             * A room mention is a string that starts with the '#' symbol and is followed by a valid room name.
             *
             * Note: We are allowing mentions in a format of #room-name The room name can contain any
             * combination of letters and hyphens
             */
            {
                name: 'reportMentions',

                regex: /(?<![^ \n*~_])(#[a-z\xB5\xDF-\xF6\xF8-\xFF\u0101\u0103\u0105\u0107\u0109\u010B\u010D\u010F\u0111\u0113\u0115\u0117\u0119\u011B\u011D\u011F\u0121\u0123\u0125\u0127\u0129\u012B\u012D\u012F\u0131\u0133\u0135\u0137\u0138\u013A\u013C\u013E\u0140\u0142\u0144\u0146\u0148\u0149\u014B\u014D\u014F\u0151\u0153\u0155\u0157\u0159\u015B\u015D\u015F\u0161\u0163\u0165\u0167\u0169\u016B\u016D\u016F\u0171\u0173\u0175\u0177\u017A\u017C\u017E-\u0180\u0183\u0185\u0188\u018C\u018D\u0192\u0195\u0199-\u019B\u019E\u01A1\u01A3\u01A5\u01A8\u01AA\u01AB\u01AD\u01B0\u01B4\u01B6\u01B9\u01BA\u01BD-\u01BF\u01C6\u01C9\u01CC\u01CE\u01D0\u01D2\u01D4\u01D6\u01D8\u01DA\u01DC\u01DD\u01DF\u01E1\u01E3\u01E5\u01E7\u01E9\u01EB\u01ED\u01EF\u01F0\u01F3\u01F5\u01F9\u01FB\u01FD\u01FF\u0201\u0203\u0205\u0207\u0209\u020B\u020D\u020F\u0211\u0213\u0215\u0217\u0219\u021B\u021D\u021F\u0221\u0223\u0225\u0227\u0229\u022B\u022D\u022F\u0231\u0233-\u0239\u023C\u023F\u0240\u0242\u0247\u0249\u024B\u024D\u024F-\u0293\u0295-\u02AF\u0371\u0373\u0377\u037B-\u037D\u0390\u03AC-\u03CE\u03D0\u03D1\u03D5-\u03D7\u03D9\u03DB\u03DD\u03DF\u03E1\u03E3\u03E5\u03E7\u03E9\u03EB\u03ED\u03EF-\u03F3\u03F5\u03F8\u03FB\u03FC\u0430-\u045F\u0461\u0463\u0465\u0467\u0469\u046B\u046D\u046F\u0471\u0473\u0475\u0477\u0479\u047B\u047D\u047F\u0481\u048B\u048D\u048F\u0491\u0493\u0495\u0497\u0499\u049B\u049D\u049F\u04A1\u04A3\u04A5\u04A7\u04A9\u04AB\u04AD\u04AF\u04B1\u04B3\u04B5\u04B7\u04B9\u04BB\u04BD\u04BF\u04C2\u04C4\u04C6\u04C8\u04CA\u04CC\u04CE\u04CF\u04D1\u04D3\u04D5\u04D7\u04D9\u04DB\u04DD\u04DF\u04E1\u04E3\u04E5\u04E7\u04E9\u04EB\u04ED\u04EF\u04F1\u04F3\u04F5\u04F7\u04F9\u04FB\u04FD\u04FF\u0501\u0503\u0505\u0507\u0509\u050B\u050D\u050F\u0511\u0513\u0515\u0517\u0519\u051B\u051D\u051F\u0521\u0523\u0525\u0527\u0529\u052B\u052D\u052F\u0560-\u0588\u10D0-\u10FA\u10FD-\u10FF\u13F8-\u13FD\u1C80-\u1C88\u1D00-\u1D2B\u1D6B-\u1D77\u1D79-\u1D9A\u1E01\u1E03\u1E05\u1E07\u1E09\u1E0B\u1E0D\u1E0F\u1E11\u1E13\u1E15\u1E17\u1E19\u1E1B\u1E1D\u1E1F\u1E21\u1E23\u1E25\u1E27\u1E29\u1E2B\u1E2D\u1E2F\u1E31\u1E33\u1E35\u1E37\u1E39\u1E3B\u1E3D\u1E3F\u1E41\u1E43\u1E45\u1E47\u1E49\u1E4B\u1E4D\u1E4F\u1E51\u1E53\u1E55\u1E57\u1E59\u1E5B\u1E5D\u1E5F\u1E61\u1E63\u1E65\u1E67\u1E69\u1E6B\u1E6D\u1E6F\u1E71\u1E73\u1E75\u1E77\u1E79\u1E7B\u1E7D\u1E7F\u1E81\u1E83\u1E85\u1E87\u1E89\u1E8B\u1E8D\u1E8F\u1E91\u1E93\u1E95-\u1E9D\u1E9F\u1EA1\u1EA3\u1EA5\u1EA7\u1EA9\u1EAB\u1EAD\u1EAF\u1EB1\u1EB3\u1EB5\u1EB7\u1EB9\u1EBB\u1EBD\u1EBF\u1EC1\u1EC3\u1EC5\u1EC7\u1EC9\u1ECB\u1ECD\u1ECF\u1ED1\u1ED3\u1ED5\u1ED7\u1ED9\u1EDB\u1EDD\u1EDF\u1EE1\u1EE3\u1EE5\u1EE7\u1EE9\u1EEB\u1EED\u1EEF\u1EF1\u1EF3\u1EF5\u1EF7\u1EF9\u1EFB\u1EFD\u1EFF-\u1F07\u1F10-\u1F15\u1F20-\u1F27\u1F30-\u1F37\u1F40-\u1F45\u1F50-\u1F57\u1F60-\u1F67\u1F70-\u1F7D\u1F80-\u1F87\u1F90-\u1F97\u1FA0-\u1FA7\u1FB0-\u1FB4\u1FB6\u1FB7\u1FBE\u1FC2-\u1FC4\u1FC6\u1FC7\u1FD0-\u1FD3\u1FD6\u1FD7\u1FE0-\u1FE7\u1FF2-\u1FF4\u1FF6\u1FF7\u210A\u210E\u210F\u2113\u212F\u2134\u2139\u213C\u213D\u2146-\u2149\u214E\u2184\u2C30-\u2C5F\u2C61\u2C65\u2C66\u2C68\u2C6A\u2C6C\u2C71\u2C73\u2C74\u2C76-\u2C7B\u2C81\u2C83\u2C85\u2C87\u2C89\u2C8B\u2C8D\u2C8F\u2C91\u2C93\u2C95\u2C97\u2C99\u2C9B\u2C9D\u2C9F\u2CA1\u2CA3\u2CA5\u2CA7\u2CA9\u2CAB\u2CAD\u2CAF\u2CB1\u2CB3\u2CB5\u2CB7\u2CB9\u2CBB\u2CBD\u2CBF\u2CC1\u2CC3\u2CC5\u2CC7\u2CC9\u2CCB\u2CCD\u2CCF\u2CD1\u2CD3\u2CD5\u2CD7\u2CD9\u2CDB\u2CDD\u2CDF\u2CE1\u2CE3\u2CE4\u2CEC\u2CEE\u2CF3\u2D00-\u2D25\u2D27\u2D2D\uA641\uA643\uA645\uA647\uA649\uA64B\uA64D\uA64F\uA651\uA653\uA655\uA657\uA659\uA65B\uA65D\uA65F\uA661\uA663\uA665\uA667\uA669\uA66B\uA66D\uA681\uA683\uA685\uA687\uA689\uA68B\uA68D\uA68F\uA691\uA693\uA695\uA697\uA699\uA69B\uA723\uA725\uA727\uA729\uA72B\uA72D\uA72F-\uA731\uA733\uA735\uA737\uA739\uA73B\uA73D\uA73F\uA741\uA743\uA745\uA747\uA749\uA74B\uA74D\uA74F\uA751\uA753\uA755\uA757\uA759\uA75B\uA75D\uA75F\uA761\uA763\uA765\uA767\uA769\uA76B\uA76D\uA76F\uA771-\uA778\uA77A\uA77C\uA77F\uA781\uA783\uA785\uA787\uA78C\uA78E\uA791\uA793-\uA795\uA797\uA799\uA79B\uA79D\uA79F\uA7A1\uA7A3\uA7A5\uA7A7\uA7A9\uA7AF\uA7B5\uA7B7\uA7B9\uA7BB\uA7BD\uA7BF\uA7C1\uA7C3\uA7C8\uA7CA\uA7D1\uA7D3\uA7D5\uA7D7\uA7D9\uA7F6\uA7FA\uAB30-\uAB5A\uAB60-\uAB68\uAB70-\uABBF\uFB00-\uFB06\uFB13-\uFB17\uFF41-\uFF5A0-9-]{1,80})/gmiu,
                replacement: '<mention-report>$1</mention-report>',
            },

            /**
             * This regex matches a valid user mention in a string.
             * A user mention is a string that starts with the '@' symbol and is followed by a valid user's primary
             * login
             *
             * Note: currently we are only allowing mentions in a format of @+19728974297 (E.164 format phone number)
             * and @username@example.com The username can contain any combination of alphanumeric letters, numbers, and
             * underscores
             */
            {
                name: 'userMentions',
                regex: new RegExp(
                    `(@here|[a-zA-Z0-9.!$%&+=?^\`{|}-]?)(@${Constants.CONST.REG_EXP.EMAIL_PART}|@${Constants.CONST.REG_EXP.PHONE_PART})(?!((?:(?!<a).)+)?<\\/a>|[^<]*(<\\/pre>|<\\/code>))`,
                    'gim',
                ),
                replacement: (match, g1, g2) => {
                    if (!Str.isValidMention(match)) {
                        return match;
                    }
                    const phoneRegex = new RegExp(`^@${Constants.CONST.REG_EXP.PHONE_PART}$`);
                    return `${g1}<mention-user>${g2}${phoneRegex.test(g2) ? `@${Constants.CONST.SMS.DOMAIN}` : ''}</mention-user>`;
                },
                rawInputReplacement: (match, g1, g2) => {
                    if (!Str.isValidMention(match)) {
                        return match;
                    }
                    return `${g1}<mention-user>${g2}</mention-user>`;
                },
            },

            {
                name: 'hereMentionAfterUserMentions',
                regex: /(<\/mention-user>)(@here)(?=\b)/gm,
                replacement: '$1<mention-here>$2</mention-here>',
            },

            /**
             * Automatically link urls. Runs last of our linkers since we want anything manual to link before this,
             * and we do not want to break emails.
             */
            {
                name: 'autolink',

                process: (textToProcess, replacement) => {
                    const regex = new RegExp(`(?![^<]*>|[^<>]*<\\/(?!h1>))([_*~]*?)${UrlPatterns.MARKDOWN_URL_REGEX}\\1(?!((?:(?!<a).)+)?<\\/a>|[^<]*(<\\/pre>|<\\/code>|.+\\/>))`, 'gi');
                    return this.modifyTextForUrlLinks(regex, textToProcess, replacement);
                },

                replacement: (match, g1, g2) => {
                    const href = Str.sanitizeURL(g2);
                    return `${g1}<a href="${href}" target="_blank" rel="noreferrer noopener">${g2}</a>${g1}`;
                },
                rawInputReplacement: (_match, g1, g2) => {
                    const href = Str.sanitizeURL(g2);
                    return `${g1}<a href="${href}" data-raw-href="${g2}" data-link-variant="auto" target="_blank" rel="noreferrer noopener">${g2}</a>${g1}`;
                },
            },

            {
                name: 'quote',

                // We also want to capture a blank line before or after the quote so that we do not add extra spaces.
                // block quotes naturally appear on their own line. Blockquotes should not appear in code fences or
                // inline code blocks. A single prepending space should be stripped if it exists
                process: (textToProcess, replacement, shouldKeepRawInput = false) => {
                    const regex = /^ *(?:&gt;)+ +(?! )(?![^<]*(?:<\/pre>|<\/code>))([^\v\n\r]+)/gm;
                    const replaceFunction = (g1) => replacement(g1, shouldKeepRawInput);
                    if (shouldKeepRawInput) {
                        return textToProcess.replace(regex, replaceFunction);
                    }
                    return this.modifyTextForQuote(regex, textToProcess, replacement);
                },
                replacement: (g1, shouldKeepRawInput = false) => {
                    // We want to enable 2 options of nested heading inside the blockquote: "># heading" and "> # heading".
                    // To do this we need to parse body of the quote without first space
                    let isStartingWithSpace = false;
                    const handleMatch = (match, g2) => {
                        if (shouldKeepRawInput) {
                            isStartingWithSpace = !!g2;
                            return '';
                        }
                        return match;
                    };
                    const textToReplace = g1.replace(/^ *&gt;( )?/gm, handleMatch);
                    const filterRules = ['heading1'];

                    // if we don't reach the max quote depth we allow the recursive call to process possible quote
                    if (this.currentQuoteDepth < this.maxQuoteDepth - 1 || isStartingWithSpace) {
                        filterRules.push('quote');
                        this.currentQuoteDepth++;
                    }

                    const replacedText = this.replace(textToReplace, {
                        filterRules,
                        shouldEscapeText: false,
                        shouldKeepRawInput,
                    });
                    this.currentQuoteDepth = 0;
                    return `<blockquote>${isStartingWithSpace ? ' ' : ''}${replacedText}</blockquote>`;
                },
            },
            {
                /**
                 * Use \b in this case because it will match on words, letters,
                 * and _: https://www.rexegg.com/regex-boundaries.html#wordboundary
                 * The !_blank is to prevent the `target="_blank">` section of the
                 * link replacement from being captured Additionally, something like
                 * `\b\_([^<>]*?)\_\b` doesn't work because it won't replace
                 * `_https://www.test.com_`
                 * Use [\s\S]* instead of .* to match newline
                 */
                name: 'italic',
                regex: /(?<!<[^>]*)(\b_+|\b)(?!_blank")_((?![\s_])[\s\S]*?[^\s_](?<!\s))_(?![^\W_])(?![^<]*>)(?![^<]*(<\/pre>|<\/code>|<\/a>|<\/mention-user>|_blank))/g,

                // We want to add extraLeadingUnderscores back before the <em> tag unless textWithinUnderscores starts with valid email
                replacement: (match, extraLeadingUnderscores, textWithinUnderscores) => {
                    if (textWithinUnderscores.includes('</pre>') || this.containsNonPairTag(textWithinUnderscores)) {
                        return match;
                    }
                    if (String(textWithinUnderscores).match(`^${Constants.CONST.REG_EXP.MARKDOWN_EMAIL}`)) {
                        return `<em>${extraLeadingUnderscores}${textWithinUnderscores}</em>`;
                    }
                    return `${extraLeadingUnderscores}<em>${textWithinUnderscores}</em>`;
                },
            },

            /**
             * Automatically links emails that are not in a link. Runs before the autolinker as it will not link an
             * email that is in a link
             * Prevent emails from starting with [~_*]. Such emails should not be supported.
             */
            {
                name: 'autoEmail',
                regex: new RegExp(`([^\\w'#%+-]|^)${Constants.CONST.REG_EXP.MARKDOWN_EMAIL}(?!((?:(?!<a).)+)?<\\/a>|[^<>]*<\\/(?!em|h1|blockquote))`, 'gim'),
                replacement: '$1<a href="mailto:$2">$2</a>',
                rawInputReplacement: '$1<a href="mailto:$2" data-raw-href="$2" data-link-variant="auto">$2</a>',
            },

            {
                // Use \B in this case because \b doesn't match * or ~.
                // \B will match everything that \b doesn't, so it works
                // for * and ~: https://www.rexegg.com/regex-boundaries.html#notb
                name: 'bold',
                regex: /(?<!<[^>]*)\B\*(?![^<]*(?:<\/pre>|<\/code>|<\/a>))((?![\s*])[\s\S]*?[^\s*](?<!\s))\*\B(?![^<]*>)(?![^<]*(<\/pre>|<\/code>|<\/a>))/g,
                replacement: (match, g1) => (g1.includes('</pre>') || this.containsNonPairTag(g1) ? match : `<strong>${g1}</strong>`),
            },
            {
                name: 'strikethrough',
                regex: /(?<!<[^>]*)\B~((?![\s~])[\s\S]*?[^\s~](?<!\s))~\B(?![^<]*>)(?![^<]*(<\/pre>|<\/code>|<\/a>))/g,
                replacement: (match, g1) => (g1.includes('</pre>') || this.containsNonPairTag(g1) ? match : `<del>${g1}</del>`),
            },
            {
                name: 'newline',
                regex: /\r?\n/g,
                replacement: '<br />',
            },
            {
                // We're removing <br /> because when </pre> and <br /> occur together, an extra line is added.
                name: 'replacepre',
                regex: /<\/pre>\s*<br\s*[/]?>/gi,
                replacement: '</pre>',
            },
            {
                // We're removing <br /> because when <h1> and <br /> occur together, an extra line is added.
                name: 'replaceh1br',
                regex: /<\/h1><br\s*[/]?>/gi,
                replacement: '</h1>',
            },
        ];

        /**
         * The list of regex replacements to do on a HTML comment for converting it to markdown.
         * Order of rules is important
         * @type {Object[]}
         */
        this.htmlToMarkdownRules = [
            // Used to Exclude tags
            {
                name: 'replacepre',
                regex: /<\/pre>(.)/gi,
                replacement: '</pre><br />$1',
            },
            {
                name: 'exclude',
                regex: new RegExp(['<(script|style)(?:"[^"]*"|\'[^\']*\'|[^\'">])*>([\\s\\S]*?)<\\/\\1>', '(?![^<]*(<\\/pre>|<\\/code>))(\n|\r\n)?'].join(''), 'gim'),
                replacement: '',
            },
            {
                name: 'nested',
                regex: /<(pre)(?:"[^"]*"|'[^']*'|[^'">])*><(div|code)(?:"[^"]*"|'[^']*'|[^'">])*>([\s\S]*?)<\/\2><\/pre>/gi,
                replacement: '<pre>$3</pre>',
            },
            {
                name: 'newline',

                // Replaces open and closing <br><br/> tags with a single <br/>
                // Slack uses special <span> tag for empty lines instead of <br> tag
                pre: (inputString) =>
                    inputString
                        .replace('<br></br>', '<br/>')
                        .replace('<br><br/>', '<br/>')
                        .replace(/(<tr.*?<\/tr>)/g, '$1<br/>')
                        .replace('<br/></tbody>', '')
                        .replace(SLACK_SPAN_NEW_LINE_TAG + SLACK_SPAN_NEW_LINE_TAG, '<br/><br/><br/>')
                        .replace(SLACK_SPAN_NEW_LINE_TAG, '<br/><br/>'),

                // Include the immediately followed newline as `<br>\n` should be equal to one \n.
                regex: /<br(?:"[^"]*"|'[^']*'|[^'"><])*>\n?/gi,
                replacement: '\n',
            },
            {
                name: 'heading1',
                regex: /[^\S\r\n]*<(h1)(?:"[^"]*"|'[^']*'|[^'">])*>(.*?)<\/\1>(?![^<]*(<\/pre>|<\/code>))/gi,
                replacement: '<h1># $2</h1>',
            },
            {
                name: 'listItem',
                regex: /\s*<(li)(?:"[^"]*"|'[^']*'|[^'">])*>(.*?)<\/\1>(?![^<]*(<\/pre>|<\/code>))\s*/gi,
                replacement: '<li>  $2</li>',
            },

            // Use [\s\S]* instead of .* to match newline
            {
                name: 'italic',
                regex: /<(em|i)(?:"[^"]*"|'[^']*'|[^'">])*>([\s\S]*?)<\/\1>(?![^<]*(<\/pre>|<\/code>))/gi,
                replacement: '_$2_',
            },
            {
                name: 'bold',
                regex: /<(b|strong)(?:"[^"]*"|'[^']*'|[^'">])*>([\s\S]*?)<\/\1>(?![^<]*(<\/pre>|<\/code>))/gi,
                replacement: '*$2*',
            },
            {
                name: 'strikethrough',
                regex: /<(del|s)(?:"[^"]*"|'[^']*'|[^'">])*>([\s\S]*?)<\/\1>(?![^<]*(<\/pre>|<\/code>))/gi,
                replacement: '~$2~',
            },
            {
                name: 'quote',
                regex: /<(blockquote|q)(?:"[^"]*"|'[^']*'|[^'">])*>([\s\S]*?)<\/\1>(?![^<]*(<\/pre>|<\/code>))/gi,
                replacement: (match, g1, g2) => {
                    // We remove the line break before heading inside quote to avoid adding extra line
                    let resultString = g2
                        .replace(/\n?(<h1># )/g, '$1')
                        .replace(/(<h1>|<\/h1>)+/g, '\n')
                        .trim()
                        .split('\n');

                    const prependGreaterSign = (m) => `> ${m}`;
                    resultString = _.map(resultString, prependGreaterSign).join('\n');
                    // We want to keep <blockquote> tag here and let method replaceBlockElementWithNewLine to handle the line break later
                    return `<blockquote>${resultString}</blockquote>`;
                },
            },
            {
                name: 'inlineCodeBlock',
                regex: /<(code)(?:"[^"]*"|'[^']*'|[^'">])*>(.*?)<\/\1>(?![^<]*(<\/pre>|<\/code>))/gi,
                replacement: '`$2`',
            },
            {
                name: 'codeFence',
                regex: /<(pre)(?:"[^"]*"|'[^']*'|[^'">])*>([\s\S]*?)(\n?)<\/\1>(?![^<]*(<\/pre>|<\/code>))/gi,
                replacement: (match, g1, g2) => `\`\`\`\n${g2}\n\`\`\``,
            },
            {
                name: 'anchor',
                regex: /<(a)[^><]*href\s*=\s*(['"])(.*?)\2(?:".*?"|'.*?'|[^'"><])*>([\s\S]*?)<\/\1>(?![^<]*(<\/pre>|<\/code>))/gi,
                replacement: (match, g1, g2, g3, g4) => {
                    const email = g3.startsWith('mailto:') ? g3.slice(7) : '';
                    if (email === g4) {
                        return email;
                    }
                    return `[${g4}](${email || g3})`;
                },
            },
            {
                name: 'image',
                regex: /<img[^><]*src\s*=\s*(['"])(.*?)\1(?:[^><]*alt\s*=\s*(['"])(.*?)\3)?[^><]*>*(?![^<][\s\S]*?(<\/pre>|<\/code>))/gi,
                replacement: (match, g1, g2, g3, g4) => {
                    if (g4) {
                        return `![${g4}](${g2})`;
                    }

                    return `!(${g2})`;
                },
            },
            {
                name: 'reportMentions',
                regex: /<mention-report reportID="(\d+)" *\/>/gi,
                replacement: (match, g1, offset, string, extras) => {
                    const reportToNameMap = extras.reportIdToName;
                    if (!reportToNameMap || !reportToNameMap[g1]) {
                        return '#Hidden';
                    }

                    return reportToNameMap[g1];
                },
            },
            {
                name: 'userMention',
                regex: /<mention-user accountID="(\d+)" *\/>/gi,
                replacement: (match, g1, offset, string, extras) => {
                    const accountToNameMap = extras.accountIdToName;
                    if (!accountToNameMap || !accountToNameMap[g1]) {
                        return '@Hidden';
                    }

                    return `@${extras.accountIdToName[g1]}`;
                },
            },
        ];

        /**
         * The list of rules to covert the HTML to text.
         * Order of rules is important
         * @type {Object[]}
         */
        this.htmlToTextRules = [
            {
                name: 'breakline',
                regex: /<br[^>]*>/gi,
                replacement: '\n',
            },
            {
                name: 'blockquoteWrapHeadingOpen',
                regex: /<blockquote><h1>/gi,
                replacement: '<blockquote>',
            },
            {
                name: 'blockquoteWrapHeadingClose',
                regex: /<\/h1><\/blockquote>/gi,
                replacement: '</blockquote>',
            },
            {
                name: 'blockElementOpen',
                regex: /(.|\s)<(blockquote|h1|pre)>/gi,
                replacement: '$1\n',
            },
            {
                name: 'blockElementClose',
                regex: /<\/(blockquote|h1|pre)>(.|\s)/gm,
                replacement: '\n$2',
            },
            {
                name: 'removeStyle',
                regex: /<style>.*?<\/style>/gi,
                replacement: '',
            },
            {
                name: 'image',
                regex: /<img[^><]*src\s*=\s*(['"])(.*?)\1(?:[^><]*alt\s*=\s*(['"])(.*?)\3)?[^><]*>*(?![^<][\s\S]*?(<\/pre>|<\/code>))/gi,
                replacement: '[Attachment]',
            },
            {
                name: 'reportMentions',
                regex: /<mention-report reportID="(\d+)" *\/>/gi,
                replacement: (match, g1, offset, string, extras) => {
                    const reportToNameMap = extras.reportIdToName;
                    if (!reportToNameMap || !reportToNameMap[g1]) {
                        return '#Hidden';
                    }

                    return reportToNameMap[g1];
                },
            },
            {
                name: 'userMention',
                regex: /<mention-user accountID="(\d+)" *\/>/gi,
                replacement: (match, g1, offset, string, extras) => {
                    const accountToNameMap = extras.accountIdToName;
                    if (!accountToNameMap || !accountToNameMap[g1]) {
                        return '@Hidden';
                    }

                    return `@${extras.accountIdToName[g1]}`;
                },
            },
            {
                name: 'stripTag',
                regex: /(<([^>]+)>)/gi,
                replacement: '',
            },
        ];

        /**
         * The list of rules that we have to exclude in shouldKeepWhitespaceRules list.
         * @type {Object[]}
         */
        this.whitespaceRulesToDisable = ['newline', 'replacepre', 'replacebr', 'replaceh1br'];

        /**
         * The list of rules that have to be applied when shouldKeepWhitespace flag is true.
         * @param {Object} rule - The rule to check.
         * @returns {boolean} Returns true if the rule should be applied, otherwise false.
         */
        this.filterRules = (rule) => !_.includes(this.whitespaceRulesToDisable, rule.name);

        /**
         * Filters rules to determine which should keep whitespace.
         * @returns {Object[]} The filtered rules.
         */
        this.shouldKeepWhitespaceRules = _.filter(this.rules, this.filterRules);

        /**
         * maxQuoteDepth is the maximum depth of nested quotes that we want to support.
         * @type {Number}
         */
        this.maxQuoteDepth = 3;

        /**
         * currentQuoteDepth is the current depth of nested quotes that we are processing.
         * @type {Number}
         */
        this.currentQuoteDepth = 0;
    },

    getHtmlRuleset(filterRules, disabledRules, shouldKeepRawInput) {
        let rules = this.rules;
        const hasRuleName = (rule) => _.contains(filterRules, rule.name);
        const hasDisabledRuleName = (rule) => !_.contains(disabledRules, rule.name);
        if (shouldKeepRawInput) {
            rules = this.shouldKeepWhitespaceRules;
        }
        if (!_.isEmpty(filterRules)) {
            rules = _.filter(this.rules, hasRuleName);
        }
        if (!_.isEmpty(disabledRules)) {
            rules = _.filter(rules, hasDisabledRuleName);
        }
        return rules;
    },

    /**
     * Replaces markdown with html elements
     *
     * @param {String} text - Text to parse as markdown
     * @param {Object} [options] - Options to customize the markdown parser
     * @param {String[]} [options.filterRules=[]] - An array of name of rules as defined in this class.
     * If not provided, all available rules will be applied.
     * @param {Boolean} [options.shouldEscapeText=true] - Whether or not the text should be escaped
     * @param {String[]} [options.disabledRules=[]] - An array of name of rules as defined in this class.
     * If not provided, all available rules will be applied. If provided, the rules in the array will be skipped.
     *
     * @returns {String}
     */
    replace(text, {filterRules = [], shouldEscapeText = true, shouldKeepRawInput = false, disabledRules = []} = {}) {
        // console.log('replace text, text.length:', text, text.length);
        // This ensures that any html the user puts into the comment field shows as raw html
        let replacedText = shouldEscapeText ? _.escape(text) : text;
        const rules = this.getHtmlRuleset(filterRules, disabledRules, shouldKeepRawInput);

        const processRule = (rule) => {
            // Pre-process text before applying regex
            if (rule.pre) {
                replacedText = rule.pre(replacedText);
            }
            const replacementFunction = shouldKeepRawInput && rule.rawInputReplacement ? rule.rawInputReplacement : rule.replacement;
            if (rule.process) {
                replacedText = rule.process(replacedText, replacementFunction, shouldKeepRawInput);
            } else {
                replacedText = replacedText.replace(rule.regex, replacementFunction);
            }

            // Post-process text after applying regex
            if (rule.post) {
                replacedText = rule.post(replacedText);
            }
        };
        try {
            rules.forEach(processRule);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Error replacing text with html in ExpensiMark.replace', {error: e});

            // We want to return text without applying rules if exception occurs during replacing
            const res = shouldEscapeText ? _.escape(text) : text;
            // console.log('result1', res);
            return res;
        }

        // console.log('result2', replacedText);
        return replacedText;
    },

    /**
     * Checks matched URLs for validity and replace valid links with html elements
     *
     * @param {RegExp} regex
     * @param {String} textToCheck
     * @param {Function} replacement
     *
     * @returns {String}
     */
    modifyTextForUrlLinks(regex, textToCheck, replacement) {
        let match = regex.exec(textToCheck);
        let replacedText = '';
        let startIndex = 0;

        while (match !== null) {
            // We end the link at the last closing parenthesis that matches an opening parenthesis because unmatched closing parentheses are unlikely to be in the url
            // and can be part of markdown for example
            let unmatchedOpenParentheses = 0;
            let url = match[2];
            for (let i = 0; i < url.length; i++) {
                if (url[i] === '(') {
                    unmatchedOpenParentheses++;
                } else if (url[i] === ')') {
                    // Unmatched closing parenthesis
                    if (unmatchedOpenParentheses <= 0) {
                        const numberOfCharsToRemove = url.length - i;
                        match[0] = match[0].substr(0, match[0].length - numberOfCharsToRemove);
                        url = url.substr(0, url.length - numberOfCharsToRemove);
                        break;
                    }
                    unmatchedOpenParentheses--;
                }
            }

            // Because we are removing ) parenthesis, some special characters that shouldn't be in the href are in the href
            // For example google.com/toto.) is accepted by the regular expression above and we remove the ) parenthesis, so the link becomes google.com/toto. which is not a valid link
            // In that case we should also remove the "."
            // Those characters should only be remove from the url if this url doesn't have a parameter or a fragment
            if (!url.includes('?') && !url.includes('#')) {
                let numberOfCharsToRemove = 0;

                for (let i = url.length - 1; i >= 0; i--) {
                    if (Constants.CONST.SPECIAL_CHARS_TO_REMOVE.includes(url[i])) {
                        numberOfCharsToRemove++;
                    } else {
                        break;
                    }
                }
                if (numberOfCharsToRemove) {
                    match[0] = match[0].substring(0, match[0].length - numberOfCharsToRemove);
                    url = url.substring(0, url.length - numberOfCharsToRemove);
                }
            }

            replacedText = replacedText.concat(textToCheck.substr(startIndex, match.index - startIndex));

            // We want to avoid matching domains in email addresses so we don't render them as URLs,
            // but we need to check if there are valid URLs after the email address and render them accordingly,
            // e.g. test@expensify.com/https://www.test.com
            let isDoneMatching = false;
            let shouldApplyAutoLinkAgain = true;

            // If we find a URL with a leading @ sign, we need look for other domains in the rest of the string
            if (match.index !== 0 && textToCheck[match.index - 1] === '@') {
                const domainRegex = /^(([a-z-0-9]+\.)+[a-z]{2,})(\S*)/i;
                const domainMatch = domainRegex.exec(url);

                // If we find another domain in the remainder of the string, we apply the auto link rule again and set a flag to avoid re-doing below.
                if (domainMatch !== null && domainMatch[3] !== '') {
                    replacedText = replacedText.concat(domainMatch[1] + this.replace(domainMatch[3], {filterRules: ['autolink']}));
                    shouldApplyAutoLinkAgain = false;
                } else {
                    // Otherwise, we're done applying rules
                    isDoneMatching = true;
                }
            }

            // We don't want to apply link rule if match[1] contains the code block inside the [] of the markdown e.g. [```example```](https://example.com)
            // or if match[1] is multiline text preceeded by markdown heading, e.g., # [example\nexample\nexample](https://example.com)
            if (isDoneMatching || match[1].includes('</pre>') || match[1].includes('</h1>')) {
                replacedText = replacedText.concat(textToCheck.substr(match.index, match[0].length));
            } else if (shouldApplyAutoLinkAgain) {
                const urlRegex = new RegExp(`^${UrlPatterns.LOOSE_URL_REGEX}$|^${UrlPatterns.URL_REGEX}$`, 'i');

                // `match[1]` contains the text inside the [] of the markdown e.g. [example](https://example.com)
                // At the entry of function this.replace, text is already escaped due to the rules that precede the link
                // rule (eg, codeFence, inlineCodeBlock, email), so we don't need to escape the text again here.
                // If the text `match[1]` exactly matches a URL, we skip translating the filterRules
                // So that special characters such as ['_', '*', '~'] are preserved in the text.
                const linkText = urlRegex.test(match[1])
                    ? match[1]
                    : this.replace(match[1], {
                          filterRules: ['bold', 'strikethrough', 'italic'],
                          shouldEscapeText: false,
                      });
                replacedText = replacedText.concat(replacement(match[0], linkText, url));
            }
            startIndex = match.index + match[0].length;

            // Now we move to the next match that the js regex found in the text
            match = regex.exec(textToCheck);
        }
        if (startIndex < textToCheck.length) {
            replacedText = replacedText.concat(textToCheck.substr(startIndex));
        }

        return replacedText;
    },

    /**
     * Checks matched Emails for validity and replace valid links with html elements
     *
     * @param {RegExp} regex
     * @param {String} textToCheck
     * @param {Function} replacement
     * @param {Boolean} shouldKeepRawInput
     *
     * @returns {String}
     */
    modifyTextForEmailLinks(regex, textToCheck, replacement, shouldKeepRawInput) {
        let match = regex.exec(textToCheck);
        let replacedText = '';
        let startIndex = 0;

        while (match !== null) {
            replacedText = replacedText.concat(textToCheck.substr(startIndex, match.index - startIndex));

            // `match[1]` contains the text inside []. Text is already escaped due to the rules
            // that precede the link rule (eg, codeFence, inlineCodeBlock, email).
            const linkText = this.replace(match[1], {
                filterRules: ['bold', 'strikethrough', 'italic'],
                shouldEscapeText: false,
            });

            // rawInputReplacment needs to be called with additional parameters from match
            const replacedMatch = shouldKeepRawInput ? replacement(match[0], linkText, match[2], match[3]) : replacement(match[0], linkText, match[3]);
            replacedText = replacedText.concat(replacedMatch);
            startIndex = match.index + match[0].length;

            // Now we move to the next match that the js regex found in the text
            match = regex.exec(textToCheck);
        }
        if (startIndex < textToCheck.length) {
            replacedText = replacedText.concat(textToCheck.substr(startIndex));
        }
        return replacedText;
    },

    /**
     * replace block element with '\n' if :
     * 1. We have text within the element.
     * 2. The text does not end with a new line.
     * 3. The text does not have quote mark '>' .
     * 4. It's not the last element in the string.
     *
     * @param {String} htmlString
     * @returns {String}
     */
    replaceBlockElementWithNewLine(htmlString) {
        // eslint-disable-next-line max-len
        let splitText = htmlString.split(
            /<div.*?>|<\/div>|<comment.*?>|\n<\/comment>|<\/comment>|<h1>|<\/h1>|<h2>|<\/h2>|<h3>|<\/h3>|<h4>|<\/h4>|<h5>|<\/h5>|<h6>|<\/h6>|<p>|<\/p>|<li>|<\/li>|<blockquote>|<\/blockquote>/,
        );
        const stripHTML = (text) => Str.stripHTML(text);
        splitText = _.map(splitText, stripHTML);
        let joinedText = '';

        // Delete whitespace at the end
        while (splitText.length) {
            if (splitText[splitText.length - 1].trim().length > 0 || splitText[splitText.length - 1].match(/\n/)) {
                break;
            }
            splitText.pop();
        }

        const processText = (text, index) => {
            if (text.trim().length === 0 && !text.match(/\n/)) {
                return;
            }

            // Insert '\n' unless it ends with '\n' or '>' or it's the last element.
            if (text.match(/[\n|>][>]?[\s]?$/) || index === splitText.length - 1) {
                joinedText += text;
            } else {
                joinedText += `${text}\n`;
            }
        };

        splitText.forEach(processText);

        return joinedText;
    },

    /**
     * Replaces HTML with markdown
     *
     * @param {String} htmlString
     * @param {Object} extras
     *
     * @returns {String}
     */
    htmlToMarkdown(htmlString, extras = {}) {
        let generatedMarkdown = htmlString;
        const body = /<(body)(?:"[^"]*"|'[^']*'|[^'"><])*>(?:\n|\r\n)?([\s\S]*?)(?:\n|\r\n)?<\/\1>(?![^<]*(<\/pre>|<\/code>))/im;
        const parseBodyTag = generatedMarkdown.match(body);

        // If body tag is found then use the content of body rather than the whole HTML
        if (parseBodyTag) {
            generatedMarkdown = parseBodyTag[2];
        }

        const processRule = (rule) => {
            // Pre-processes input HTML before applying regex
            if (rule.pre) {
                generatedMarkdown = rule.pre(generatedMarkdown);
            }

            // if replacement is a function, we want to pass optional extras to it
            const replacementFunction = typeof rule.replacement === 'function' ? (...args) => rule.replacement(...args, extras) : rule.replacement;
            generatedMarkdown = generatedMarkdown.replace(rule.regex, replacementFunction);
        };

        this.htmlToMarkdownRules.forEach(processRule);
        return Str.htmlDecode(this.replaceBlockElementWithNewLine(generatedMarkdown));
    },

    /**
     * Convert HTML to text
     *
     * @param {String} htmlString
     * @param {Object} extras
     *
     * @returns {String}
     */
    htmlToText(htmlString, extras = {}) {
        let replacedText = htmlString;
        const processRule = (rule) => {
            // if replacement is a function, we want to pass optional extras to it
            const replacementFunction = typeof rule.replacement === 'function' ? (...args) => rule.replacement(...args, extras) : rule.replacement;
            replacedText = replacedText.replace(rule.regex, replacementFunction);
        };

        this.htmlToTextRules.forEach(processRule);

        // Unescaping because the text is escaped in 'replace' function
        // We use 'htmlDecode' instead of 'unescape' to replace entities like '&#32;'
        replacedText = Str.htmlDecode(replacedText);
        return replacedText;
    },

    /**
     * Modify text for Quotes replacing chevrons with html elements
     *
     * @param {RegExp} regex
     * @param {String} textToCheck
     * @param {Function} replacement
     *
     * @returns {String}
     */

    modifyTextForQuote(regex, textToCheck, replacement) {
        let replacedText = '';
        let textToFormat = '';
        const match = textToCheck.match(regex);

        // If there's matches we need to modify the quotes
        if (match !== null) {
            let insideCodefence = false;

            // Split the textToCheck in lines
            const textSplitted = textToCheck.split('\n');

            for (let i = 0; i < textSplitted.length; i++) {
                if (!insideCodefence) {
                    // We need to know when there is a start of codefence so we dont quote
                    insideCodefence = Str.contains(textSplitted[i], '<pre>');
                }

                // We only want to modify lines starting with &gt; that is not codefence
                // if (Str.startsWith(textSplitted[i], '&gt;') && !insideCodefence) {
                if (textSplitted[i].match(/^ *&gt;/) && !insideCodefence) {
                    textToFormat += `${textSplitted[i]}\n`;
                } else {
                    // Make sure we will only modify if we have Text needed to be formatted for quote
                    if (textToFormat !== '') {
                        replacedText += this.formatTextForQuote(regex, textToFormat, replacement);
                        textToFormat = '';
                    }

                    // We dont want a \n after the textSplitted if it is the last row
                    if (i === textSplitted.length - 1) {
                        replacedText += `${textSplitted[i]}`;
                    } else {
                        replacedText += `${textSplitted[i]}\n`;
                    }

                    // We need to know when we are not inside codefence anymore
                    if (insideCodefence) {
                        insideCodefence = !Str.contains(textSplitted[i], '</pre>');
                    }
                }
            }

            // When loop ends we need the last quote to be formatted if we have quotes at last rows
            if (textToFormat !== '') {
                replacedText += this.formatTextForQuote(regex, textToFormat, replacement);
            }
        } else {
            // If we doesn't have matches make sure the function will return the same textToCheck
            replacedText = textToCheck;
        }
        return replacedText;
    },

    /**
     * Format the content of blockquote if the text matches the regex or else just return the original text
     *
     * @param {RegExp} regex
     * @param {String} textToCheck
     * @param {Function} replacement
     *
     * @returns {String}
     */
    formatTextForQuote(regex, textToCheck, replacement) {
        if (textToCheck.match(regex)) {
            // Remove '&gt;' and trim the spaces between nested quotes
            const formatRow = (row) => {
                // const quoteContent = row[4] === ' ' ? row.substr(5) : row.substr(4);
                const quoteContent = row.replace(/^ *&gt;(.*)/, '$1');
                // console.log('--- row, quoteContent', row, quoteContent, row.length, quoteContent.length);
                return quoteContent.trimStart();
            };
            let textToFormat = _.map(textToCheck.split('\n'), formatRow).join('\n');

            // Remove leading and trailing line breaks
            textToFormat = textToFormat.replace(/^\n+|\n+$/g, '');
            return replacement(textToFormat);
        }
        return textToCheck;
    },

    /**
     * Check if the input text includes only the open or the close tag of an element.
     *
     * @param {String} textToCheck - Text to check
     *
     * @returns {Boolean}
     */
    containsNonPairTag(textToCheck) {
        // Create a regular expression to match HTML tags
        const tagRegExp = /<([a-z][a-z0-9-]*)\b[^>]*>|<\/([a-z][a-z0-9-]*)\s*>/gi;

        // Use a stack to keep track of opening tags
        const tagStack = [];

        // Match all HTML tags in the string
        let match = tagRegExp.exec(textToCheck);
        while (match) {
            const openingTag = match[1];
            const closingTag = match[2];

            if (openingTag && openingTag !== 'br') {
                // If it's an opening tag, push it onto the stack
                tagStack.push(openingTag);
            } else if (closingTag) {
                // If it's a closing tag, pop the top of the stack
                const expectedTag = tagStack.pop();

                // If the closing tag doesn't match the expected opening tag, return false
                if (closingTag !== expectedTag) {
                    return true;
                }
            }
            match = tagRegExp.exec(textToCheck);
        }

        // If there are any tags left in the stack, they're unclosed
        return tagStack.length !== 0;
    },

    /**
     * @param {String} comment
     * @returns {Array} or undefined if exception occurs when executing regex matching
     */
    extractLinksInMarkdownComment(comment) {
        try {
            const htmlString = this.replace(comment, {filterRules: ['link']});
            // We use same anchor tag template as link and autolink rules to extract link
            const regex = new RegExp(`<a href="${UrlPatterns.MARKDOWN_URL_REGEX}" target="_blank" rel="noreferrer noopener">`, 'gi');
            const matches = [...htmlString.matchAll(regex)];

            // Element 1 from match is the regex group if it exists which contains the link URLs
            const sanitizeMatch = (match) => Str.sanitizeURL(match[1]);
            const links = _.map(matches, sanitizeMatch);
            return links;
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Error parsing url in ExpensiMark.extractLinksInMarkdownComment', {error: e});
            return undefined;
        }
    },

    /**
     * Compares two markdown comments and returns a list of the links removed in a new comment.
     *
     * @param {String} oldComment
     * @param {String} newComment
     * @returns {Array}
     */
    getRemovedMarkdownLinks(oldComment, newComment) {
        const linksInOld = this.extractLinksInMarkdownComment(oldComment);
        const linksInNew = this.extractLinksInMarkdownComment(newComment);
        return linksInOld === undefined || linksInNew === undefined ? [] : _.difference(linksInOld, linksInNew);
    },

    /**
     * Escapes the content of an HTML attribute value
     * @param {String} content - string content that possible contains HTML
     * @returns {String} - original MD content escaped for use in HTML attribute value
     */
    escapeAttributeContent(content) {
        let originalContent = this.htmlToMarkdown(content);
        if (content === originalContent) {
            return content;
        }

        // When the attribute contains HTML and is converted back to MD we need to re-escape it to avoid
        // illegal attribute value characters like `," or ' which might break the HTML
        originalContent = Str.replaceAll(originalContent, '\n', '');
        return _.escape(originalContent);
    },
}

ExpensiMark.initializer();
