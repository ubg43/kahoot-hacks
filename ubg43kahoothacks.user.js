
// ==UserScript==

// @name         KaHoax Improved (kahoot hack but better)

// @version      3.0

// @description  A hack for kahoot.it! Supports Quiz ID, Quiz URL, Quiz Name search, and Game PIN lookup.

// @namespace    https://github.com/KRWCLASSIC

// @match        https://kahoot.it/*

// @icon         https://raw.githubusercontent.com/KRWCLASSIC/KaHoax/refs/heads/main/kahoot.svg

// @author       Valhalla

// @license      All rights reserved. Copyright © KaHoax © 2026 Valhalla_Vikings (for edits)

// @grant        none

// @downloadURL https://update.greasyfork.org/scripts/573770/KaHoax%20Improved%20%28kahoot%20hack%20but%20better%29.user.js

// @updateURL https://update.greasyfork.org/scripts/573770/KaHoax%20Improved%20%28kahoot%20hack%20but%20better%29.meta.js

// ==/UserScript==

(function() {

    var Version = '1.2.0.0';

    var questions = [];

    var info = {

        numQuestions: 0,

        questionNum: -1,

        lastAnsweredQuestion: -1,

        defaultIL: true,

        ILSetQuestion: -1,

    };

    var PPT = 900;

    var Answered_PPT = 900;

    var autoAnswer = false;

    var showAnswers = false;

    var inputLag = 100;

    var lastValidQuizID = null;

    // ─── AUTO-PIN STATE ────────────────────────────────────────────────────────

    var autoLoadedPin = null;      // PIN we already auto-loaded a quiz for

    var autoPinEnabled = true;     // user can toggle this off

    var autoPinResolvingFor = null;// debounce: track which pin is being resolved

    // ──────────────────────────────────────────────────────────────────────────

    function FindByAttributeValue(attribute, value, element_type) {

        element_type = element_type || "*";

        var All = document.getElementsByTagName(element_type);

        for (var i = 0; i < All.length; i++) {

            if (All[i].getAttribute(attribute) == value) return All[i];

        }

    }

    function sanitizeInput(val) {

        val = val.trim();

        if (val.indexOf("https//") === 0) val = val.replace("https//", "https://");

        if (/^https?:\/\//i.test(val)) {

            var parts = val.replace(/^https?:\/\//i, '').split('/');

            return parts.filter(Boolean).pop();

        }

        return val;

    }

    function isValidGameId(str) {

        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

    }

    function isGamePin(str) {

        return /^\d{4,10}$/.test(str.trim());

    }

    // ─── IMPROVED PIN DETECTION ────────────────────────────────────────────────

    // Tries every known Kahoot PIN location in the DOM and JS state.

    function detectLiveGamePin() {

        // 1. Visible PIN display elements (in-game header / lobby)

        const selectors = [

            '[data-functional-selector="game-pin"]',

            '[data-functional-selector="game-pin-header"]',

            '[data-functional-selector="game-pin-text"]',

            '.game-pin',

            '#game-pin',

            '[class*="gamePin"]',

            '[class*="game-pin"]',

            '[id*="game-pin"]',

            '[id*="gamePin"]',

        ];

        for (const sel of selectors) {

            try {

                const el = document.querySelector(sel);

                if (el) {

                    const txt = el.textContent.replace(/\D/g, '').trim();

                    if (isGamePin(txt)) return txt;

                }

            } catch(e) {}

        }

        // 2. Input field (join page)

        const pinInput = document.querySelector('input[name="gameId"][data-functional-selector="game-pin-input"]')

                      || document.querySelector('input[data-functional-selector="game-pin-input"]')

                      || document.querySelector('input[placeholder*="PIN" i]')

                      || document.querySelector('input[placeholder*="pin" i]')

                      || document.querySelector('input[name="gameId"]');

        if (pinInput && isGamePin((pinInput.value || '').trim())) return pinInput.value.trim();

        // 3. Kahoot JS globals — check multiple known paths

        try {

            const paths = [

                () => window.kahoot?.gameBlock?.pin,

                () => window.__NEXT_DATA__?.props?.pageProps?.pin,

                () => window.__NEXT_DATA__?.props?.pageProps?.gameBlock?.pin,

                () => window.__KAHOOT_STATE__?.gameBlock?.pin,

                () => window.appState?.pin,

                () => window.Kahoot?.pin,

            ];

            for (const fn of paths) {

                try {

                    const v = fn();

                    if (v && isGamePin(String(v))) return String(v);

                } catch(_) {}

            }

        } catch(e) {}

        // 4. URL query param

        const urlPin = new URLSearchParams(window.location.search).get('pin');

        if (urlPin && isGamePin(urlPin)) return urlPin;

        // 5. Deep scan: look for any element containing ONLY digits (4-10) that

        //    is visually prominent (large font or inside a heading/strong)

        try {

            const candidates = document.querySelectorAll('h1,h2,h3,strong,[class*="pin"],[id*="pin"],[class*="Pin"],[id*="Pin"]');

            for (const el of candidates) {

                const txt = (el.textContent || '').replace(/\s/g, '');

                if (isGamePin(txt)) return txt;

            }

        } catch(e) {}

        return null;

    }

    // ──────────────────────────────────────────────────────────────────────────

    function resolveGamePin(pin, silent) {

        if (!silent) inputBox.style.backgroundColor = '#555555';

        const sessionUrl = `https://kahoot.it/reserve/session/${encodeURIComponent(pin)}/?${Date.now()}`;

        console.log('[KaHoax] PIN session URL:', sessionUrl);

        fetch(sessionUrl, { credentials: 'omit' })

            .then(res => {

                if (!res.ok) throw new Error(`Session lookup HTTP ${res.status}`);

                return res.json();

            })

            .then(session => {

                const quizId = session.quizId

                    || session.quiz_id

                    || (session.quiz && session.quiz.uuid);

                if (!quizId) throw new Error('quizId not found in session response');

                console.log(`[KaHoax] PIN ${pin} → quiz ID: ${quizId}`);

                if (!silent) inputBox.value = quizId;

                fetchQuizById(quizId, silent);

            })

            .catch(err => {

                console.error('[KaHoax] PIN resolve error:', err);

                if (!silent) {

                    inputBox.style.backgroundColor = 'red';

                    searchPublicUUID(pin);

                } else {

                    // silent auto-load failed, allow retry next poll cycle

                    autoPinResolvingFor = null;

                }

            });

    }

    function fetchQuizById(quizId, silent) {

        const url = 'https://damp-leaf-16aa.johnwee.workers.dev/api-proxy/' + encodeURIComponent(quizId);

        console.log('[KaHoax] Direct lookup URL:', url);

        fetch(url)

            .then(response => {

                if (!response.ok) throw new Error('Direct lookup failed');

                return response.json();

            })

            .then(data => {

                console.log('[KaHoax] Direct lookup data:', data);

                if (!silent) {

                    inputBox.style.backgroundColor = 'green';

                    dropdown.style.display = 'none';

                    dropdownCloseButton.style.display = 'none';

                } else {

                    // Show subtle auto-loaded indicator on the AUTO badge

                    autoPinBadge.textContent = '⚡ AUTO';

                    autoPinBadge.style.backgroundColor = '#4CAF50';

                    setTimeout(() => {

                        autoPinBadge.textContent = autoPinEnabled ? '⚡ AUTO' : '⚡ OFF';

                        autoPinBadge.style.backgroundColor = autoPinEnabled ? '#1976D2' : '#555';

                    }, 2500);

                }

                questions = parseQuestions(data.questions);

                info.numQuestions = questions.length;

                lastValidQuizID = quizId;

                updateQuestionsList(data.questions);

            })

            .catch(error => {

                console.error('[KaHoax] Direct lookup error:', error);

                if (!silent) {

                    inputBox.style.backgroundColor = 'red';

                    info.numQuestions = 0;

                    searchPublicUUID(quizId);

                } else {

                    autoPinResolvingFor = null;

                }

            });

    }

    function updateQuestionsList(questionsData) {

        questionList.innerHTML = '';

        if (!questionsData || questionsData.length === 0) {

            questionList.appendChild(noQuestionsMsg);

            return;

        }

        let validQuestionsCount = 0;

        questionsData.forEach((question, index) => {

            if ((!question.question || question.question === '[No question text]') &&

                (!question.choices || question.choices.length === 0)) return;

            validQuestionsCount++;

            const questionItem = document.createElement('div');

            questionItem.className = 'question-item';

            questionItem.style.cssText = 'margin-bottom:8px;border-radius:3px;overflow:hidden;border:1px solid #444';

            const questionHeader = document.createElement('div');

            questionHeader.className = 'question-header';

            questionHeader.style.cssText = 'padding:8px 10px;background-color:#333;display:flex;align-items:center;cursor:pointer;position:relative';

            const questionBadge = document.createElement('div');

            questionBadge.style.cssText = 'background-color:#555;color:white;border-radius:3px;padding:2px 5px;font-size:0.7em;margin-right:8px;min-width:18px;text-align:center';

            questionBadge.textContent = `${index + 1}`;

            questionHeader.appendChild(questionBadge);

            const questionText = document.createElement('div');

            questionText.style.cssText = 'flex:1;font-size:0.85em;color:white;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

            questionText.innerHTML = question.question || '[No question text]';

            questionHeader.appendChild(questionText);

            const toggleArrow = document.createElement('div');

            toggleArrow.style.marginLeft = '10px';

            toggleArrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(0deg);transition:transform 0.3s"><polyline points="6 9 12 15 18 9"></polyline></svg>';

            toggleArrow.style.color = '#999';

            questionHeader.appendChild(toggleArrow);

            questionItem.appendChild(questionHeader);

            const contentContainer = document.createElement('div');

            contentContainer.className = 'question-content';

            contentContainer.style.cssText = 'max-height:0;overflow:hidden;transition:max-height 0.3s ease-out;background-color:#2a2a2a;border-top:1px solid #444;padding:0 10px';

            const fullQuestion = document.createElement('div');

            fullQuestion.style.cssText = 'padding:10px 0;color:white;font-size:0.85em;border-bottom:1px dashed #444';

            fullQuestion.innerHTML = question.question || '[No question text]';

            contentContainer.appendChild(fullQuestion);

            const answersSection = document.createElement('div');

            answersSection.style.padding = '10px 0';

            if (question.choices && question.choices.length > 0) {

                const answersTitle = document.createElement('div');

                answersTitle.style.cssText = 'font-weight:bold;font-size:0.8em;color:#ccc;margin-bottom:5px';

                answersTitle.textContent = 'Answers:';

                answersSection.appendChild(answersTitle);

                const answersGrid = document.createElement('div');

                answersGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(45%,1fr));gap:5px';

                question.choices.forEach(choice => {

                    const answerItem = document.createElement('div');

                    answerItem.style.cssText = `display:flex;align-items:center;padding:5px;background-color:${choice.correct ? 'rgba(76,175,80,0.1)' : 'rgba(255,255,255,0.05)'};border-radius:3px;border:1px solid ${choice.correct ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.1)'};min-height:26px`;

                    const answerIcon = document.createElement('div');

                    answerIcon.innerHTML = choice.correct

                        ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'

                        : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>';

                    answerIcon.style.cssText = 'margin-right:5px;display:flex;align-items:center;justify-content:center';

                    answerItem.appendChild(answerIcon);

                    const answerText = document.createElement('div');

                    answerText.style.cssText = `font-size:0.8em;color:${choice.correct ? '#4CAF50' : '#fff'};flex:1;overflow:hidden;text-overflow:ellipsis;line-height:1.4;display:flex;align-items:center`;

                    answerText.innerHTML = choice.answer || '[No answer text]';

                    answerItem.appendChild(answerText);

                    answersGrid.appendChild(answerItem);

                });

                answersSection.appendChild(answersGrid);

            } else {

                const noChoices = document.createElement('p');

                noChoices.textContent = 'No answer choices available';

                noChoices.style.cssText = 'color:#999;font-style:italic;font-size:0.8em';

                answersSection.appendChild(noChoices);

            }

            contentContainer.appendChild(answersSection);

            questionItem.appendChild(contentContainer);

            let isExpanded = false;

            questionHeader.addEventListener('click', () => {

                isExpanded = !isExpanded;

                contentContainer.style.maxHeight = isExpanded ? '500px' : '0';

                contentContainer.style.padding = '0 10px';

                toggleArrow.querySelector('svg').style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';

                questionHeader.style.backgroundColor = isExpanded ? '#3c3c3c' : '#333';

            });

            questionHeader.addEventListener('mouseover', () => { if (!isExpanded) questionHeader.style.backgroundColor = '#3a3a3a'; });

            questionHeader.addEventListener('mouseout', () => { if (!isExpanded) questionHeader.style.backgroundColor = '#333'; });

            questionList.appendChild(questionItem);

        });

        if (validQuestionsCount === 0) questionList.appendChild(noQuestionsMsg);

    }

    function resetUI(restoreLastValidID = false) {

        inputBox.value = restoreLastValidID && lastValidQuizID ? lastValidQuizID : "";

        inputBox.style.backgroundColor = '#333333';

        dropdown.style.display = 'none';

        dropdownCloseButton.style.display = 'none';

        if (restoreLastValidID && lastValidQuizID) { handleInputChange(); return; }

        questions = [];

        info.numQuestions = 0;

        info.questionNum = -1;

        info.lastAnsweredQuestion = -1;

        questionsLabel.textContent = 'Question 0 / ?';

        updateQuestionsList([]);

        lastKnownPin = null;

        gamePinLabel.textContent = 'None';

        gamePinBox.removeAttribute('data-pin');

        gamePinBox.removeAttribute('data-has-pin');

        gamePinBox.style.cursor = 'default';

        copyIcon.style.display = 'none';

        // Reset auto-load state so it can retry

        autoLoadedPin = null;

        autoPinResolvingFor = null;

    }

    // --- UI Creation ---

    const uiElement = document.createElement('div');

    uiElement.className = 'floating-ui';

    uiElement.style.cssText = 'position:fixed;top:5%;left:5%;width:350px;max-width:90vw;height:auto;max-height:90vh;overflow-y:auto;background-color:#1e1e1e;border-radius:10px;box-shadow:0px 0px 10px 0px rgba(0,0,0,0.5);z-index:9999;font-size:16px';

    const handle = document.createElement('div');

    handle.className = 'handle';

    handle.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:1em;color:#fff;width:100%;height:40px;background-color:#2c2c2c;border-radius:10px 10px 0 0;cursor:grab;text-align:left;padding-left:15px;line-height:40px;box-sizing:border-box;display:flex;align-items:center;position:sticky;top:0;z-index:10001';

    const kahootIcon = document.createElement('img');

    kahootIcon.src = 'https://icons.iconarchive.com/icons/simpleicons-team/simple/256/kahoot-icon.png';

    kahootIcon.style.cssText = 'height:22px;width:22px;margin-right:8px;filter:brightness(0) invert(1)';

    handle.appendChild(kahootIcon);

    const appTitle = document.createElement('span');

    appTitle.textContent = 'UBG43';

    appTitle.style.color = 'white';

    handle.appendChild(appTitle);

    const versionSpan = document.createElement('span');

    versionSpan.textContent = 'v' + Version;

    versionSpan.style.cssText = 'font-size:0.8em;opacity:0.7;margin-left:5px';

    appTitle.appendChild(versionSpan);

    uiElement.appendChild(handle);

    const closeButton = document.createElement('div');

    closeButton.textContent = '✕';

    closeButton.style.cssText = 'position:absolute;top:0;right:0;width:40px;height:40px;background-color:#ff4d4d;color:white;border-radius:0 10px 0 0;display:flex;justify-content:center;align-items:center;cursor:pointer;font-size:1em';

    handle.appendChild(closeButton);

    const minimizeButton = document.createElement('div');

    minimizeButton.textContent = '─';

    minimizeButton.style.cssText = 'color:white;position:absolute;top:0;right:40px;width:40px;height:40px;background-color:#555555;display:flex;justify-content:center;align-items:center;cursor:pointer;font-size:1em';

    handle.appendChild(minimizeButton);

    const headerText = document.createElement('h2');

    headerText.textContent = 'QUIZ ID, NAME, or GAME PIN';

    headerText.style.cssText = 'display:block;margin:15px 0;text-align:center;font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:1.25em;color:white;text-shadow:0 0 5px rgba(0,0,0,0.5)';

    uiElement.appendChild(headerText);

    // ─── AUTO-PIN STATUS BANNER ────────────────────────────────────────────────

    const autoPinBanner = document.createElement('div');

    autoPinBanner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:0 auto 10px auto;width:90%;background:#1a2a3a;border:1px solid #1976D2;border-radius:6px;padding:6px 10px;box-sizing:border-box';

    const autoPinInfo = document.createElement('span');

    autoPinInfo.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:0.78em;color:#90CAF9';

    autoPinInfo.textContent = 'Auto-detects game PIN & loads quiz';

    autoPinBanner.appendChild(autoPinInfo);

    const autoPinBadge = document.createElement('span');

    autoPinBadge.textContent = '⚡ AUTO';

    autoPinBadge.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:0.72em;font-weight:bold;padding:2px 8px;border-radius:20px;background-color:#1976D2;color:white;cursor:pointer;user-select:none;transition:background-color 0.3s';

    autoPinBadge.title = 'Click to toggle auto-PIN detection';

    autoPinBadge.addEventListener('click', () => {

        autoPinEnabled = !autoPinEnabled;

        autoPinBadge.textContent = autoPinEnabled ? '⚡ AUTO' : '⚡ OFF';

        autoPinBadge.style.backgroundColor = autoPinEnabled ? '#1976D2' : '#555';

        autoPinInfo.textContent = autoPinEnabled ? 'Auto-detects game PIN & loads quiz' : 'Auto-detection disabled';

        autoPinInfo.style.color = autoPinEnabled ? '#90CAF9' : '#888';

        autoPinBanner.style.borderColor = autoPinEnabled ? '#1976D2' : '#555';

        autoPinBanner.style.backgroundColor = autoPinEnabled ? '#1a2a3a' : '#222';

        if (autoPinEnabled) {

            // Re-enable: reset so it can auto-load again

            autoLoadedPin = null;

            autoPinResolvingFor = null;

        }

    });

    autoPinBanner.appendChild(autoPinBadge);

    uiElement.appendChild(autoPinBanner);

    // ──────────────────────────────────────────────────────────────────────────

    const inputContainer = document.createElement('div');

    inputContainer.style.cssText = 'display:flex;flex-direction:column;align-items:center;position:relative;width:90%;margin:0 auto 15px auto';

    const inputBox = document.createElement('input');

    inputBox.type = 'text';

    inputBox.placeholder = 'Quiz ID, Game PIN, or search name...';

    inputBox.style.cssText = 'color:#ffffff;width:100%;height:35px;margin:0;padding:0 10px;border:1px solid #444444;border-radius:10px;outline:none;text-align:center;font-size:0.9em;background-color:#333333;box-sizing:border-box';

    inputContainer.appendChild(inputBox);

    inputBox.addEventListener('input', function() {

        if (inputBox.value.trim() === "") resetUI();

    });

    inputBox.addEventListener('keydown', function(e) {

        if (e.key === 'Enter') handleInputChange();

    });

    const buttonContainer = document.createElement('div');

    buttonContainer.style.cssText = 'display:flex;width:100%;margin-top:10px;gap:8px;justify-content:space-between';

    function makeIconButton(title, innerHTML) {

        const btn = document.createElement('button');

        btn.title = title;

        btn.style.cssText = 'width:35px;height:35px;background-color:#6c757d;color:white;border:none;border-radius:5px;cursor:pointer;display:flex;justify-content:center;align-items:center;transition:background-color 0.3s';

        btn.innerHTML = innerHTML;

        btn.addEventListener('mouseover', () => { btn.style.backgroundColor = '#5a6268'; });

        btn.addEventListener('mouseout', () => { btn.style.backgroundColor = '#6c757d'; });

        return btn;

    }

    const kahootButton = makeIconButton('Open quiz on Kahoot', `<img src="https://icons.iconarchive.com/icons/simpleicons-team/simple/256/kahoot-icon.png" style="height:20px;width:20px;filter:brightness(0) invert(1)">`);

    kahootButton.addEventListener('click', () => {

        if (lastValidQuizID) {

            window.open(`https://create.kahoot.it/details/${lastValidQuizID}`, '_blank');

            kahootButton.style.backgroundColor = '#4CAF50';

            setTimeout(() => { kahootButton.style.backgroundColor = '#6c757d'; }, 500);

        } else {

            kahootButton.style.backgroundColor = '#F44336';

            setTimeout(() => { kahootButton.style.backgroundColor = '#6c757d'; }, 500);

        }

    });

    buttonContainer.appendChild(kahootButton);

    const enterButton = document.createElement('button');

    enterButton.textContent = 'Enter';

    enterButton.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;flex-grow:1;height:35px;font-size:0.9em;cursor:pointer;background-color:#6c757d;color:white;border:none;border-radius:5px;padding:8px;transition:background-color 0.3s';

    enterButton.addEventListener('click', handleInputChange);

    enterButton.addEventListener('mouseover', () => { enterButton.style.backgroundColor = '#5a6268'; });

    enterButton.addEventListener('mouseout', () => { enterButton.style.backgroundColor = '#6c757d'; });

    buttonContainer.appendChild(enterButton);

    const copyButton = makeIconButton('Copy verified Quiz ID', `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`);

    copyButton.addEventListener('click', () => {

        if (lastValidQuizID) {

            navigator.clipboard.writeText(lastValidQuizID).then(() => {

                copyButton.style.backgroundColor = '#4CAF50';

                setTimeout(() => { copyButton.style.backgroundColor = '#6c757d'; }, 500);

            });

        }

    });

    buttonContainer.appendChild(copyButton);

    const pasteButton = makeIconButton('Paste from clipboard', `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M9 12h6"></path><path d="M12 9v6"></path></svg>`);

    pasteButton.addEventListener('click', () => {

        navigator.clipboard.readText().then(text => {

            const cleaned = text.trim();

            if (isValidGameId(cleaned) || isGamePin(cleaned)) {

                inputBox.value = cleaned;

                pasteButton.style.backgroundColor = '#4CAF50';

                setTimeout(() => { pasteButton.style.backgroundColor = '#6c757d'; }, 500);

            } else {

                pasteButton.style.backgroundColor = '#F44336';

                setTimeout(() => { pasteButton.style.backgroundColor = '#6c757d'; }, 500);

            }

        }).catch(() => {

            pasteButton.style.backgroundColor = '#F44336';

            setTimeout(() => { pasteButton.style.backgroundColor = '#6c757d'; }, 500);

        });

    });

    buttonContainer.appendChild(pasteButton);

    inputContainer.appendChild(buttonContainer);

    const dropdown = document.createElement('div');

    dropdown.style.cssText = 'position:absolute;top:calc(100% + 5px);left:0;width:100%;background-color:#2c2c2c;border:1px solid #444444;border-radius:10px;z-index:10000;max-height:min(300px,calc(90vh - 100% - 20px));overflow-y:auto;display:none;box-sizing:border-box';

    inputContainer.appendChild(dropdown);

    const dropdownHeader = document.createElement('div');

    dropdownHeader.style.cssText = 'position:sticky;top:0;width:100%;background-color:#333;padding:8px 0;text-align:right;margin-bottom:5px;z-index:10002;box-sizing:border-box';

    const dropdownCloseButton = document.createElement('button');

    dropdownCloseButton.textContent = 'X';

    dropdownCloseButton.style.cssText = 'width:25px;height:25px;background-color:red;color:white;border:none;border-radius:50%;cursor:pointer;font-size:0.8em;display:none;margin-right:10px';

    dropdownCloseButton.addEventListener('click', () => resetUI(true));

    dropdownHeader.appendChild(dropdownCloseButton);

    dropdown.appendChild(dropdownHeader);

    uiElement.appendChild(inputContainer);

    // ANSWERING

    const header3 = document.createElement('h2');

    header3.textContent = 'ANSWERING';

    header3.style.cssText = 'display:block;margin:15px 0;text-align:center;font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:1.25em;color:white;text-shadow:0 0 5px rgba(0,0,0,0.5)';

    uiElement.appendChild(header3);

    const answeringContainer = document.createElement('div');

    answeringContainer.style.cssText = 'display:flex;flex-direction:column;align-items:center;margin:15px auto;width:90%';

    uiElement.appendChild(answeringContainer);

    const togglesContainer = document.createElement('div');

    togglesContainer.style.cssText = 'display:flex;align-items:center;justify-content:space-evenly;width:100%;margin-bottom:15px';

    answeringContainer.appendChild(togglesContainer);

    function makeToggle(labelText, onChange) {

        const container = document.createElement('div');

        container.style.cssText = 'display:flex;align-items:center;gap:10px';

        const label = document.createElement('span');

        label.textContent = labelText;

        label.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:0.9em;color:white';

        container.appendChild(label);

        const sw = document.createElement('label');

        sw.className = 'switch';

        sw.style.cssText = 'position:relative;display:inline-block;width:40px;height:20px;margin-left:5px';

        const inp = document.createElement('input');

        inp.type = 'checkbox';

        inp.style.cssText = 'opacity:0;width:0;height:0';

        sw.appendChild(inp);

        const slider = document.createElement('span');

        slider.className = 'slider';

        slider.style.cssText = 'position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#888888;transition:0.4s;border-radius:10px';

        const thumb = document.createElement('span');

        thumb.style.cssText = 'position:absolute;height:16px;width:16px;left:2px;bottom:2px;background-color:#ffffff;transition:0.4s;border-radius:50%';

        slider.appendChild(thumb);

        sw.appendChild(slider);

        container.appendChild(sw);

        inp.addEventListener('change', function() {

            thumb.style.transform = this.checked ? 'translateX(20px)' : 'translateX(0)';

            slider.style.backgroundColor = this.checked ? '#4CAF50' : '#888888';

            onChange(this.checked);

        });

        return container;

    }

    togglesContainer.appendChild(makeToggle('Auto', checked => {

        autoAnswer = checked;

        info.ILSetQuestion = info.questionNum;

    }));

    togglesContainer.appendChild(makeToggle('Show', checked => { showAnswers = checked; }));

    const sliderContainer = document.createElement('div');

    sliderContainer.style.cssText = 'width:100%;margin:0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center';

    const pointsLabel = document.createElement('span');

    pointsLabel.textContent = 'Points per Question: ~900';

    pointsLabel.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:0.9em;margin:0 0 10px 0;color:white';

    sliderContainer.appendChild(pointsLabel);

    const pointsSlider = document.createElement('input');

    pointsSlider.type = 'range';

    pointsSlider.min = '500';

    pointsSlider.max = '1000';

    pointsSlider.value = '900';

    pointsSlider.style.cssText = 'width:100%;height:10px;border:none;outline:none;cursor:pointer';

    pointsSlider.className = 'custom-slider';

    pointsSlider.addEventListener('input', () => {

        PPT = +pointsSlider.value;

        pointsLabel.textContent = 'Points per Question: ~' + PPT;

    });
    sliderContainer.appendChild(pointsSlider);

    answeringContainer.appendChild(sliderContainer);

    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `

    .custom-slider{-webkit-appearance:none;height:8px;background:#444;border-radius:4px;outline:none}

    .custom-slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;background:#fff;border-radius:50%;cursor:pointer;margin-top:-5px}

    .custom-slider::-moz-range-thumb{width:18px;height:18px;background:#fff;border-radius:50%;cursor:pointer}

    .custom-slider::-webkit-slider-runnable-track{width:100%;height:8px;background:#888;border-radius:4px}

    .custom-slider::-moz-range-track{width:100%;height:8px;background:#888;border-radius:4px}

    .floating-ui *::-webkit-scrollbar{width:8px;height:8px}

    .floating-ui *::-webkit-scrollbar-track{background:#222;border-radius:4px}

    .floating-ui *::-webkit-scrollbar-thumb{background:#555;border-radius:4px;border:2px solid #222}

    .floating-ui *::-webkit-scrollbar-thumb:hover{background:#777}

    .floating-ui *{scrollbar-width:thin;scrollbar-color:#555 #222}

    .floating-ui::-webkit-scrollbar{width:8px}

    .floating-ui::-webkit-scrollbar-track{background:transparent;margin:5px 0}

    .floating-ui::-webkit-scrollbar-thumb{background:rgba(85,85,85,0.6);border-radius:10px;border:2px solid #1e1e1e}

    .switch input:checked+.slider:before{transform:translateX(20px)}

    .switch .slider:before{position:absolute;content:'';height:16px;width:16px;left:2px;bottom:2px;background-color:white;transition:.4s;border-radius:50%}

    .switch input:checked+.slider{background-color:#4CAF50}

    @media(max-width:768px){.floating-ui{width:85vw;left:7.5vw;font-size:14px}.handle{height:35px;line-height:35px}.close-button,.minimize-button{width:35px;height:35px}.switch{width:36px;height:18px}.switch .slider:before{height:14px;width:14px}.switch input:checked+.slider:before{transform:translateX(18px)}}

    @media(max-width:385px) and (min-width:356px){.role-badge{font-size:0.574em !important;padding:1.64px 4.1px !important;border-radius:8.2px !important}.role-badges-container{gap:3.28px !important}}

    @media(max-width:355px){.role-badge{font-size:0.525em !important;padding:1.5px 3.75px !important;border-radius:7.5px !important}.role-badges-container{gap:3px !important}}

    ` }));

    // INFO

    const header4 = document.createElement('h2');

    header4.textContent = 'INFO';

    header4.style.cssText = 'display:block;margin:15px 0;text-align:center;font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:1.25em;color:white;text-shadow:0 0 5px rgba(0,0,0,0.5)';

    uiElement.appendChild(header4);

    const questionsLabel = document.createElement('span');

    questionsLabel.textContent = 'Question 0 / ?';

    questionsLabel.style.cssText = 'display:block;font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:0.9em;text-align:center;margin:10px 0 5px 0;color:white';

    uiElement.appendChild(questionsLabel);

    const gamePinContainer = document.createElement('div');

    gamePinContainer.style.cssText = 'display:flex;flex-direction:row;align-items:center;justify-content:center;margin:0 0 8px 0;width:100%;gap:6px';

    const allQuestionsContainer = document.createElement('div');

    allQuestionsContainer.style.cssText = 'display:flex;flex-direction:column;width:90%;margin:0 auto 10px auto;overflow:hidden';

    const allQuestionsHeader = document.createElement('div');

    allQuestionsHeader.style.cssText = 'display:flex;align-items:center;padding:8px 10px;cursor:pointer;background-color:#2c2c2c;border-radius:5px;border:1px solid #444;transition:background-color 0.2s;margin-bottom:0';

    const arrowIcon = document.createElement('span');

    arrowIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(0deg);transition:transform 0.3s"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    arrowIcon.style.cssText = 'display:inline-block;margin-right:8px;color:#999';

    const allQuestionsText = document.createElement('span');

    allQuestionsText.textContent = 'All Questions';

    allQuestionsText.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;color:white;font-size:0.9em';

    allQuestionsHeader.appendChild(arrowIcon);

    allQuestionsHeader.appendChild(allQuestionsText);

    allQuestionsContainer.appendChild(allQuestionsHeader);

    const questionsContent = document.createElement('div');

    questionsContent.style.cssText = 'max-height:0;overflow:hidden;transition:max-height 0.3s ease-out;background-color:#2a2a2a;border-radius:5px;margin-top:5px;padding:0;border:none;display:none';

    const questionList = document.createElement('div');

    questionList.className = 'question-list';

    questionList.style.cssText = 'font-size:0.8em;padding:8px 5px;color:#fff;max-height:300px;overflow-y:auto';

    questionsContent.appendChild(questionList);

    allQuestionsContainer.appendChild(questionsContent);

    const noQuestionsMsg = document.createElement('div');

    noQuestionsMsg.textContent = 'No questions available. Load a quiz first.';

    noQuestionsMsg.style.cssText = 'padding:10px;color:#999;font-style:italic;font-size:0.85em;text-align:center';

    questionList.appendChild(noQuestionsMsg);

    let isQuestionsExpanded = false;

    allQuestionsHeader.addEventListener('click', () => {

        isQuestionsExpanded = !isQuestionsExpanded;

        if (isQuestionsExpanded) {

            questionsContent.style.display = 'block';

            questionsContent.style.border = '1px solid #444';

            questionsContent.style.padding = '5px';

            questionsContent.style.transition = 'max-height 0.15s ease-out';

            void questionsContent.offsetHeight;

            arrowIcon.querySelector('svg').style.transform = 'rotate(180deg)';

            questionsContent.style.maxHeight = '400px';

            questionsContent.style.overflow = 'visible';

            allQuestionsHeader.style.backgroundColor = '#3c3c3c';

        } else {

            arrowIcon.querySelector('svg').style.transform = 'rotate(0deg)';

            allQuestionsHeader.style.backgroundColor = '#2c2c2c';

            questionsContent.style.transition = 'none';

            questionsContent.style.maxHeight = '0';

            questionsContent.style.overflow = 'hidden';

            questionsContent.style.border = 'none';

            questionsContent.style.display = 'none';

            questionsContent.style.padding = '0';

        }

    });

    allQuestionsHeader.addEventListener('mouseover', () => { if (!isQuestionsExpanded) allQuestionsHeader.style.backgroundColor = '#383838'; });

    allQuestionsHeader.addEventListener('mouseout', () => { if (!isQuestionsExpanded) allQuestionsHeader.style.backgroundColor = '#2c2c2c'; });

    const gamePinTitle = document.createElement('span');

    gamePinTitle.textContent = 'Game PIN:';

    gamePinTitle.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:0.9em;color:white';

    gamePinContainer.appendChild(gamePinTitle);

    const gamePinBox = document.createElement('div');

    gamePinBox.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:fit-content;min-width:80px;max-width:130px;padding:2px 6px;background-color:#333;border:1px solid #444;border-radius:3px;cursor:pointer;transition:all 0.2s ease;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

    const gamePinLabel = document.createElement('span');

    gamePinLabel.textContent = 'None';

    gamePinLabel.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:0.9em;color:white;margin-right:3px;flex:1;text-align:center;min-width:40px;display:inline-block';

    const copyIcon = document.createElement('span');

    copyIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

    copyIcon.style.cssText = 'color:#999;display:inline-block;vertical-align:middle;flex-shrink:0;line-height:1';

    gamePinBox.appendChild(gamePinLabel);

    gamePinBox.appendChild(copyIcon);

    gamePinContainer.appendChild(gamePinBox);

    gamePinBox.addEventListener('mouseover', () => {

        if (gamePinBox.getAttribute('data-has-pin') === 'true') { gamePinBox.style.backgroundColor = '#444'; copyIcon.style.color = '#03A9F4'; }

    });

    gamePinBox.addEventListener('mouseout', () => { gamePinBox.style.backgroundColor = '#333'; copyIcon.style.color = '#999'; });

    gamePinBox.addEventListener('click', () => {

        const pin = gamePinBox.getAttribute('data-pin');

        if (pin) {

            navigator.clipboard.writeText(pin).then(() => {

                const orig = gamePinLabel.textContent;

                gamePinLabel.textContent = 'Copied!';

                copyIcon.style.color = '#4CAF50';

                gamePinBox.style.backgroundColor = 'rgba(76,175,80,0.2)';

                setTimeout(() => { gamePinLabel.textContent = orig; copyIcon.style.color = '#999'; gamePinBox.style.backgroundColor = '#333'; }, 1000);

            });

        }

    });

    uiElement.appendChild(gamePinContainer);

    uiElement.appendChild(allQuestionsContainer);

    // Links section

    const linksSection = document.createElement('div');

    linksSection.style.cssText = 'margin:15px 0;padding:0 15px';

    const githubIcon = '<svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" fill="none" width="16" height="16"><path stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="12" d="M120.755 170c.03-4.669.059-20.874.059-27.29 0-9.272-3.167-15.339-6.719-18.41 22.051-2.464 45.201-10.863 45.201-49.067 0-10.855-3.824-19.735-10.175-26.683 1.017-2.516 4.413-12.63-.987-26.32 0 0-8.296-2.672-27.202 10.204-7.912-2.213-16.371-3.308-24.784-3.352-8.414.044-16.872 1.14-24.785 3.352C52.457 19.558 44.162 22.23 44.162 22.23c-5.4 13.69-2.004 23.804-.987 26.32C36.824 55.498 33 64.378 33 75.233c0 38.204 23.149 46.603 45.2 49.067-3.551 3.071-6.719 9.138-6.719 18.41 0 6.416.03 22.621.059 27.29M27 130c9.939.703 15.67 9.735 15.67 9.735 8.834 15.199 23.178 10.803 28.815 8.265"></path></svg>';

    const webIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';

    const toolIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';

    const badgeColors = { 'UI':'#E91E63','Mobile':'#2196F3','Features':'#9C27B0','Base':'#4CAF50','Bug Tester':'#FF9800','Old UI':'#795548','API':'#607D8B' };

    function createDeveloperEntry(name, links, roles) {

        const entry = document.createElement('div');

        entry.style.cssText = 'display:flex;align-items:center;margin:8px 0;position:relative';

        const devName = document.createElement('span');

        devName.textContent = name;

        devName.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;color:white;font-weight:bold;margin-right:10px';

        entry.appendChild(devName);

        const iconsContainer = document.createElement('div');

        iconsContainer.style.cssText = 'display:flex;gap:8px';

        links.forEach(link => {

            const a = document.createElement('a');

            a.href = link.url; a.target = '_blank'; a.title = link.title;

            a.style.cssText = 'display:flex;align-items:center;justify-content:center;color:#03A9F4;text-decoration:none';

            const span = document.createElement('span');

            span.innerHTML = link.icon;

            span.style.cssText = 'width:16px;height:16px;display:flex;justify-content:center;align-items:center';

            a.appendChild(span);

            iconsContainer.appendChild(a);

        });

        entry.appendChild(iconsContainer);

        if (roles && roles.length > 0) {

            const bc = document.createElement('div');

            bc.className = 'role-badges-container';

            bc.style.cssText = 'position:absolute;right:0;top:50%;transform:translateY(-50%);display:flex;gap:4px';

            roles.forEach(role => {

                const badge = document.createElement('div');

                badge.className = 'role-badge';

                badge.dataset.role = role;

                badge.style.cssText = `background-color:${badgeColors[role]||'#888'};color:white;font-size:0.7em;padding:2px 5px;border-radius:10px;opacity:0.7;cursor:default;font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;white-space:nowrap`;

                badge.textContent = role;

                bc.appendChild(badge);

            });

            entry.appendChild(bc);

        }

        return entry;

    }

    linksSection.appendChild(createDeveloperEntry('KRWCLASSIC', [{icon:githubIcon,url:'https://github.com/KRWCLASSIC',title:'GitHub'}], ['UI','Bug Tester','Features']));

    linksSection.appendChild(createDeveloperEntry('johnweeky', [{icon:githubIcon,url:'https://github.com/johnweeky',title:'GitHub'},{icon:webIcon,url:'https://johnw.ee',title:'Website'},{icon:toolIcon,url:'https://landing.kahoot.space',title:'JW Tool Suite'}], ['API','Mobile','Features']));

    linksSection.appendChild(createDeveloperEntry('jokeri2222', [{icon:githubIcon,url:'https://github.com/jokeri2222',title:'GitHub'}], ['Base','Old UI','Features']));

    linksSection.appendChild(createDeveloperEntry('Epic0001', [{icon:githubIcon,url:'https://github.com/Epic0001',title:'GitHub'}], ['Bug Tester']));

    uiElement.appendChild(linksSection);

    const ownerCredit = document.createElement('div');

    ownerCredit.textContent = 'made by the owner of UBG43';

    ownerCredit.style.cssText = 'margin:10px 15px 16px 15px;padding:9px 10px;text-align:center;font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:0.72em;font-weight:600;letter-spacing:0.3px;color:rgba(255,255,255,0.68);border-top:1px solid rgba(255,255,255,0.10);text-shadow:0 0 8px rgba(138,43,226,0.25)';

    uiElement.appendChild(ownerCredit);



    closeButton.addEventListener('click', () => {

        document.body.removeChild(uiElement);

        autoAnswer = false; showAnswers = false;

    });

    let isMinimized = false;

    minimizeButton.addEventListener('click', () => {

        isMinimized = !isMinimized;

        const sections = [headerText, header3, header4, questionsLabel, linksSection, autoPinBanner, ownerCredit];

        const flexSections = [gamePinContainer, allQuestionsContainer, answeringContainer];

        const flexInputs = [inputContainer];

        if (isMinimized) {

            sections.forEach(s => s.style.display = 'none');

            flexSections.forEach(s => s.style.display = 'none');

            flexInputs.forEach(s => s.style.display = 'none');

            sliderContainer.style.display = 'none';

            uiElement.style.height = '40px';

            uiElement.style.overflowY = 'hidden';

        } else {

            sections.forEach(s => s.style.display = 'block');

            flexSections.forEach(s => s.style.display = 'flex');

            flexInputs.forEach(s => s.style.display = 'flex');

            sliderContainer.style.display = 'flex';

            uiElement.style.height = 'auto';

            uiElement.style.maxHeight = '90vh';

            uiElement.style.overflowY = 'auto';

        }

    });

    let isDragging = false, offsetX, offsetY;

    handle.addEventListener('mousedown', e => {

        isDragging = true;

        offsetX = e.clientX - uiElement.getBoundingClientRect().left;

        offsetY = e.clientY - uiElement.getBoundingClientRect().top;

    });

    document.addEventListener('mousemove', e => {

        if (isDragging) { uiElement.style.left = (e.clientX - offsetX) + 'px'; uiElement.style.top = (e.clientY - offsetY) + 'px'; }

    });

    document.addEventListener('mouseup', () => { isDragging = false; });

    document.addEventListener('touchend', () => { isDragging = false; });

    // --- Fallback name-search dropdown ---

    function searchPublicUUID(searchTerm) {

        fetch('https://damp-leaf-16aa.johnwee.workers.dev/rest/kahoots/?query=' + encodeURIComponent(searchTerm))

          .then(r => r.json())

          .then(data => {

              const results = (data.entities && data.entities.length > 0) ? data.entities : [];

              dropdown.innerHTML = "";

              if (results.length > 0) {

                  dropdown.appendChild(dropdownHeader);

                  results.forEach(entity => {

                      const card = entity.card || {};

                      const displayTitle = card.title || card.name || "No title";

                      const displayCover = card.cover || card.image || 'https://dummyimage.com/50x50/ccc/fff.png&text=No+Image';

                      const quizUUID = card.uuid || card.id || "";

                      const item = document.createElement('div');

                      item.style.cssText = 'display:flex;align-items:center;padding:8px;cursor:pointer;border-bottom:1px solid #444';

                      item.addEventListener('mouseover', () => { item.style.backgroundColor = '#444'; });

                      item.addEventListener('mouseout', () => { item.style.backgroundColor = 'transparent'; });

                      const img = document.createElement('img');

                      img.src = displayCover; img.alt = displayTitle;

                      img.style.cssText = 'width:40px;height:40px;margin-right:10px;border-radius:5px;object-fit:cover';

                      const text = document.createElement('span');

                      text.textContent = displayTitle;

                      text.style.cssText = 'font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;font-size:0.9em;word-break:break-word;flex:1';

                      item.appendChild(img); item.appendChild(text);

                      item.addEventListener('click', async function() {

                          try {

                              const res = await fetch('https://damp-leaf-16aa.johnwee.workers.dev/api-proxy/' + encodeURIComponent(quizUUID));

                              if (!res.ok) throw new Error("Fetch failed");

                              const data = await res.json();

                              if (item.classList.contains('expanded-item')) return;

                              item.classList.add('expanded-item');

                              item.innerHTML = '';

                              const hdr = document.createElement('div');

                              hdr.style.cssText = 'display:flex;align-items:center;width:100%;padding:8px;box-sizing:border-box;cursor:pointer';

                              const img2 = document.createElement('img');

                              img2.src = displayCover; img2.alt = displayTitle;

                              img2.style.cssText = 'width:40px;height:40px;margin-right:10px;border-radius:5px;object-fit:cover';

                              hdr.appendChild(img2);

                              const txt2 = document.createElement('span');

                              txt2.textContent = displayTitle;

                              txt2.style.cssText = 'color:#fff;font-size:0.9em;word-break:break-word;flex:1';

                              hdr.appendChild(txt2);

                              const content = document.createElement('div');

                              content.style.cssText = 'width:100%;margin-top:10px;display:block';

                              const qCount = document.createElement('p');

                              qCount.textContent = `Questions: ${data.questions?.length || 0}`;

                              qCount.style.cssText = 'margin:5px 0;font-size:0.85em;font-weight:bold;color:#fff;padding:0 10px';

                              content.appendChild(qCount);

                              const qListEl = document.createElement('div');

                              qListEl.style.cssText = 'font-size:0.8em;margin:5px 0;padding:0 10px 10px;background:#333;border:1px solid #555;border-radius:5px';

                              const navEl = document.createElement('div');

                              navEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:8px 0';

                              const indEl = document.createElement('span'); indEl.style.color = '#fff'; indEl.style.fontSize = '0.9em';

                              const prevBtn = document.createElement('button');

                              prevBtn.textContent = '←'; prevBtn.style.cssText = 'background:#444;color:white;border:none;border-radius:3px;padding:1px 6px;font-size:0.8em;cursor:pointer';

                              const nextBtn = document.createElement('button');

                              nextBtn.textContent = '→'; nextBtn.style.cssText = 'background:#444;color:white;border:none;border-radius:3px;padding:1px 6px;font-size:0.8em;cursor:pointer';

                              navEl.appendChild(prevBtn); navEl.appendChild(indEl); navEl.appendChild(nextBtn);

                              qListEl.appendChild(navEl);

                              const qContentEl = document.createElement('div');

                              qContentEl.style.cssText = 'border:1px solid #555;border-radius:3px;padding:8px;margin-bottom:5px';

                              qListEl.appendChild(qContentEl);

                              let curIdx = 0;

                              const total = data.questions?.length || 0;

                              const updateQ = () => {

                                  indEl.textContent = `Q${curIdx + 1}/${total}`;

                                  qContentEl.innerHTML = '';

                                  const q = data.questions[curIdx];

                                  if (q) {

                                      const qt = document.createElement('p');

                                      qt.innerHTML = q.question || '[No question text]';

                                      qt.style.cssText = 'color:#fff;margin:1px 0 5px;font-weight:bold;font-size:0.9em';

                                      qContentEl.appendChild(qt);

                                      if (q.choices && q.choices.length > 0) {

                                          const ul = document.createElement('ul');

                                          ul.style.cssText = 'list-style-type:none;padding:0;margin:5px 0 0 0';

                                          q.choices.forEach(c => {

                                              const li = document.createElement('li');

                                              li.style.cssText = `padding:2px 3px;margin:2px 0;border-radius:3px;background:${c.correct?'rgba(0,255,0,0.2)':'transparent'};color:${c.correct?'#00ff00':'#fff'};font-size:0.85em`;

                                              const sp = document.createElement('span'); sp.innerHTML = c.answer || '[No answer text]';

                                              li.appendChild(document.createTextNode(c.correct ? '✓ ' : '○ '));

                                              li.appendChild(sp);

                                              ul.appendChild(li);

                                          });

                                          qContentEl.appendChild(ul);

                                      }

                                  }

                                  prevBtn.disabled = curIdx === 0; prevBtn.style.opacity = curIdx === 0 ? '0.5' : '1';

                                  nextBtn.disabled = curIdx === total - 1; nextBtn.style.opacity = curIdx === total - 1 ? '0.5' : '1';

                              };

                              prevBtn.addEventListener('click', e => { e.stopPropagation(); if (curIdx > 0) { curIdx--; updateQ(); } });

                              nextBtn.addEventListener('click', e => { e.stopPropagation(); if (curIdx < total - 1) { curIdx++; updateQ(); } });

                              updateQ();

                              content.appendChild(qListEl);

                              const linkEl = document.createElement('a');

                              linkEl.href = `https://create.kahoot.it/details/${quizUUID}`;

                              linkEl.target = '_blank';

                              linkEl.style.cssText = 'display:block;margin:5px auto;padding:5px 10px;font-size:0.9em;font-weight:bold;text-decoration:none;width:fit-content;text-align:center';

                              const linkBg = document.createElement('span');

                              linkBg.style.cssText = 'background:linear-gradient(to right,#ff3355,#0088ff,#00cc44,#ffcc00);-webkit-background-clip:text;background-clip:text;color:transparent';

                              linkBg.textContent = 'View full quiz on Kahoot →';

                              linkEl.appendChild(linkBg);

                              content.appendChild(linkEl);

                              const selBtn = document.createElement('button');

                              selBtn.textContent = 'Select this quiz';

                              selBtn.style.cssText = 'display:block;width:calc(100% - 20px);margin:8px 10px;padding:8px 12px;cursor:pointer;color:#fff;font-weight:bold;background:#6c757d;border:none;border-radius:5px;font-size:0.9em;font-family:"Montserrat","Noto Sans Arabic","Helvetica Neue",Helvetica,Arial,sans-serif;transition:background-color 0.3s';

                              selBtn.addEventListener('mouseover', () => { selBtn.style.backgroundColor = '#5a6268'; });

                              selBtn.addEventListener('mouseout', () => { selBtn.style.backgroundColor = '#6c757d'; });

                              selBtn.addEventListener('click', e => {

                                  e.stopPropagation();

                                  inputBox.value = quizUUID;

                                  dropdown.style.display = 'none';

                                  dropdownCloseButton.style.display = 'none';

                                  handleInputChange();

                              });

                              content.appendChild(selBtn);

                              item.appendChild(hdr); item.appendChild(content);

                              item.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;border-bottom:1px solid #444';

                              hdr.addEventListener('click', e => {

                                  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;

                                  content.style.display = content.style.display === 'none' ? 'block' : 'none';

                                  item.style.padding = content.style.display === 'none' ? '0' : '8px';

                                  e.stopPropagation();

                              });

                          } catch(err) { console.error('[KaHoax] Preview fetch failed:', err); }

                      });

                      dropdown.appendChild(item);

                  });

                  dropdown.style.display = 'block';

                  dropdownCloseButton.style.display = 'inline-block';

              } else {

                  dropdown.style.display = 'none';

                  dropdownCloseButton.style.display = 'none';

              }

          })

          .catch(() => { dropdown.style.display = 'none'; dropdownCloseButton.style.display = 'none'; });

    }

    function handleInputChange() {

        const quizID = sanitizeInput(inputBox.value);

        if (quizID === "") {

            inputBox.style.backgroundColor = '#333333';

            info.numQuestions = 0;

            return;

        }

        if (isGamePin(quizID)) {

            console.log('[KaHoax] Detected game PIN:', quizID);

            resolveGamePin(quizID, false);

        } else if (isValidGameId(quizID)) {

            fetchQuizById(quizID, false);

        } else {

            inputBox.style.backgroundColor = '#555555';

            info.numQuestions = 0;

            searchPublicUUID(quizID);

        }

    }

    document.body.appendChild(uiElement);

    new ResizeObserver(entries => {

        for (const entry of entries) {

            if (!isMinimized && entry.target === uiElement) {

                uiElement.style.overflowY = uiElement.scrollHeight > uiElement.clientHeight ? 'auto' : 'hidden';

            }

        }

    }).observe(uiElement);

    function parseQuestions(questionsJson) {

        return questionsJson.map(question => {

            const q = { type: question.type, time: question.time };

            if (['quiz', 'multiple_select_quiz'].includes(question.type)) {

                q.answers = []; q.incorrectAnswers = [];

                question.choices.forEach((c, i) => { (c.correct ? q.answers : q.incorrectAnswers).push(i); });

            }

            if (question.type === 'open_ended') {

                q.answers = question.choices.map(c => c.answer);

            }

            return q;

        });

    }

    function onQuestionStart() {

        const question = questions[info.questionNum];

        if (showAnswers) highlightAnswers(question);

        if (autoAnswer) answer(question, (question.time - question.time / (500 / (PPT - 500))) - inputLag);

    }

    function highlightAnswers(question) {

        question.answers.forEach(a => setTimeout(() => {

            const btn = FindByAttributeValue("data-functional-selector", 'answer-' + a, "button");

            if (btn) btn.style.backgroundColor = 'rgb(0,255,0)';

        }, 0));

        question.incorrectAnswers.forEach(a => setTimeout(() => {

            const btn = FindByAttributeValue("data-functional-selector", 'answer-' + a, "button");

            if (btn) btn.style.backgroundColor = 'rgb(255,0,0)';

        }, 0));

    }

    function answer(question, time) {

        Answered_PPT = PPT;

        const delay = question.type === 'multiple_select_quiz' ? 60 : 0;

        setTimeout(() => {

            if (question.type === 'quiz') {

                window.dispatchEvent(new KeyboardEvent('keydown', { key: (+question.answers[0] + 1).toString() }));

            }

            if (question.type === 'multiple_select_quiz') {

                question.answers.forEach(a => setTimeout(() => {

                    window.dispatchEvent(new KeyboardEvent('keydown', { key: (+a + 1).toString() }));

                }, 0));

                setTimeout(() => {

                    const sb = FindByAttributeValue("data-functional-selector", 'multi-select-submit-button', "button");

                    if (sb) sb.click();

                }, 0);

            }

        }, time - delay);

    }

    // ─── MAIN POLL LOOP ────────────────────────────────────────────────────────

    setInterval(() => {

        // --- Question tracking ---

        const textEl = FindByAttributeValue("data-functional-selector", "question-index-counter", "div");

        if (textEl) info.questionNum = +textEl.textContent - 1;

        if (FindByAttributeValue("data-functional-selector", 'answer-0', "button") && info.lastAnsweredQuestion !== info.questionNum) {

            info.lastAnsweredQuestion = info.questionNum;

            onQuestionStart();

        }

        if (autoAnswer && info.ILSetQuestion !== info.questionNum) {

            const ppt = Answered_PPT > 987 ? 1000 : Answered_PPT;

            const incEl = FindByAttributeValue("data-functional-selector", "score-increment", "span");

            if (incEl) {

                info.ILSetQuestion = info.questionNum;

                const inc = +incEl.textContent.split(" ")[1];

                if (inc !== 0) {

                    inputLag += (ppt - inc) * 15;

                    if (inputLag < 0) { inputLag -= (ppt - inc) * 15; inputLag += (ppt - inc / 2) * 15; }

                    inputLag = Math.round(inputLag);

                }

            }

        }

        questionsLabel.textContent = 'Question ' + (info.questionNum + 1) + ' / ' + (info.numQuestions > 0 ? info.numQuestions : '?');

        // --- PIN detection (display + auto-load) ---

        try {

            let foundPin = detectLiveGamePin() || lastKnownPin;

            if (foundPin) lastKnownPin = foundPin;

            if (isGameRelatedPage()) {

                if (foundPin) {

                    gamePinLabel.textContent = foundPin;

                    gamePinBox.setAttribute('data-pin', foundPin);

                    gamePinBox.setAttribute('data-has-pin', 'true');

                    gamePinBox.style.cursor = 'pointer';

                    copyIcon.style.display = 'inline-block';

                    // ── AUTO-LOAD: silently resolve pin → quiz if not already done ──

                    if (autoPinEnabled

                        && foundPin !== autoLoadedPin

                        && foundPin !== autoPinResolvingFor

                        && info.numQuestions === 0) {

                        autoPinResolvingFor = foundPin;

                        console.log('[KaHoax] Auto-loading quiz for PIN:', foundPin);

                        resolveGamePin(foundPin, true);

                        // Mark it so we don't re-trigger until pin changes or quiz resets

                        autoLoadedPin = foundPin;

                    }

                } else {

                    gamePinLabel.textContent = 'None';

                    gamePinBox.removeAttribute('data-pin'); gamePinBox.removeAttribute('data-has-pin');

                    gamePinBox.style.cursor = 'default'; copyIcon.style.display = 'none';

                }

            } else {

                gamePinLabel.textContent = 'None';

                gamePinBox.removeAttribute('data-pin'); gamePinBox.removeAttribute('data-has-pin');

                gamePinBox.style.cursor = 'default'; copyIcon.style.display = 'none';

            }

        } catch(e) { console.error('[KaHoax] PIN check error:', e); }

    }, 1);

    // ──────────────────────────────────────────────────────────────────────────

    let lastUrl = window.location.href;

    let lastKnownPin = null;

    const isGameRelatedPage = () => {

        const p = window.location.pathname;

        return ['/join','/instructions','/start','/getready','/gameblock','/answer','/ranking','/contentblock'].some(s => p.includes(s));

    };

    new MutationObserver(() => {

        if (lastUrl !== window.location.href) {

            lastUrl = window.location.href;

            if (isGameRelatedPage() && lastKnownPin) {

                gamePinLabel.textContent = lastKnownPin;

                gamePinBox.setAttribute('data-pin', lastKnownPin);

                gamePinBox.setAttribute('data-has-pin', 'true');

                gamePinBox.style.cursor = 'pointer';

                copyIcon.style.display = 'inline-block';

            } else if (!isGameRelatedPage()) {

                gamePinLabel.textContent = 'None';

                gamePinBox.removeAttribute('data-pin'); gamePinBox.removeAttribute('data-has-pin');

                gamePinBox.style.cursor = 'default'; copyIcon.style.display = 'none';

                // Page left game — allow auto-load to fire fresh next time

                autoLoadedPin = null;

                autoPinResolvingFor = null;

            }

        }

    }).observe(document, { subtree: true, childList: true });

    setTimeout(() => {

        document.querySelectorAll('[data-role]').forEach(b => b.classList.add('role-badge'));

    }, 500);

})();