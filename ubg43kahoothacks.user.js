
// ==UserScript==

// @name UBG43

// @version      3.0

// @description  A hack for kahoot.it! Supports Quiz ID, Quiz URL, Quiz Name search, and Game PIN lookup.

// @namespace https://github.com/ubg43/kahoot-hacks

// @match        https://kahoot.it/*


// @author       Valhalla

// @license      All rights reserved. Copyright © KaHoax © 2026 Valhalla_Vikings (for edits)

// @grant        none

// @downloadURL https://raw.githubusercontent.com/ubg43/kahoot-hacks/main/ubg43kahoothacks.user.js

// @updateURL https://raw.githubusercontent.com/ubg43/kahoot-hacks/main/ubg43kahoothacks.meta.js

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

    // UBG43 site section

    const linksSection = document.createElement('div');

    linksSection.style.cssText = 'margin:15px 0;padding:0 15px';

    const siteCard = document.createElement('div');

    siteCard.className = 'site-card';

    siteCard.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 14px !important;text-align:center;border:1px solid rgba(124,92,255,0.20) !important;border-radius:12px !important;background:linear-gradient(135deg,rgba(124,92,255,0.13),rgba(61,131,238,0.08)) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,0.035),0 10px 24px rgba(0,0,0,0.12)';

    const siteTitle = document.createElement('div');

    siteTitle.textContent = 'UBG43';

    siteTitle.style.cssText = 'font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;font-size:1.05em;font-weight:800;letter-spacing:.3px';

    siteCard.appendChild(siteTitle);

    const siteDescription = document.createElement('div');

    siteDescription.textContent = 'Visit the UBG43 website';

    siteDescription.style.cssText = 'font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#9ca7be;font-size:.74em;font-weight:600';

    siteCard.appendChild(siteDescription);

    const siteButton = document.createElement('a');

    siteButton.href = 'https://ubg43.github.io/';

    siteButton.target = '_blank';

    siteButton.rel = 'noopener noreferrer';

    siteButton.textContent = 'Open UBG43 ↗';

    siteButton.style.cssText = 'display:inline-flex !important;align-items:center;justify-content:center;min-width:136px;margin-top:3px;padding:9px 15px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:linear-gradient(135deg,#7c5cff,#3d83ee);color:#fff !important;text-decoration:none !important;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:.76em;font-weight:800;letter-spacing:.2px;box-shadow:0 8px 18px rgba(61,131,238,.18);transition:transform .16s ease,filter .16s ease,box-shadow .16s ease';

    siteButton.addEventListener('mouseenter', () => {

        siteButton.style.transform = 'translateY(-1px)';

        siteButton.style.filter = 'brightness(1.08)';

        siteButton.style.boxShadow = '0 10px 22px rgba(61,131,238,.25)';

    });

    siteButton.addEventListener('mouseleave', () => {

        siteButton.style.transform = 'translateY(0)';

        siteButton.style.filter = 'brightness(1)';

        siteButton.style.boxShadow = '0 8px 18px rgba(61,131,238,.18)';

    });

    siteCard.appendChild(siteButton);

    linksSection.appendChild(siteCard);

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

    // --- Professional UBG43 UI polish (visual-only layer) ---
    closeButton.classList.add('ui-close');
    minimizeButton.classList.add('ui-minimize');
    headerText.classList.add('ui-section-title');
    header3.classList.add('ui-section-title');
    header4.classList.add('ui-section-title');
    autoPinBanner.classList.add('pin-banner');
    autoPinInfo.classList.add('pin-banner-info');
    autoPinBadge.classList.add('pin-badge');
    inputContainer.classList.add('input-area');
    buttonContainer.classList.add('button-row');
    answeringContainer.classList.add('answering-panel');
    togglesContainer.classList.add('toggle-row');
    sliderContainer.classList.add('score-control');
    questionsLabel.classList.add('question-status');
    gamePinContainer.classList.add('game-pin-row');
    gamePinBox.classList.add('game-pin-box');
    allQuestionsContainer.classList.add('questions-panel');
    allQuestionsHeader.classList.add('questions-panel-header');
    questionsContent.classList.add('questions-panel-content');
    dropdown.classList.add('search-dropdown');
    dropdownHeader.classList.add('search-dropdown-header');
    linksSection.classList.add('links-section');
    ownerCredit.classList.add('owner-credit');

    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
        .floating-ui{
            --ubg-bg:#0c1019;
            --ubg-panel:#141a28;
            --ubg-panel-soft:rgba(255,255,255,.032);
            --ubg-border:rgba(255,255,255,.09);
            --ubg-accent:#7c5cff;
            --ubg-accent-2:#3d83ee;
            --ubg-text:#f5f7ff;
            --ubg-muted:#9ca7be;
            box-sizing:border-box;
            width:390px !important;
            max-width:calc(100vw - 24px) !important;
            max-height:88vh !important;
            overflow-x:hidden !important;
            padding-bottom:2px;
            background:
                radial-gradient(circle at 10% 0%,rgba(124,92,255,.15),transparent 31%),
                radial-gradient(circle at 100% 20%,rgba(61,131,238,.12),transparent 29%),
                linear-gradient(180deg,#111725 0%,#0b0f18 100%) !important;
            border:1px solid var(--ubg-border) !important;
            border-radius:17px !important;
            box-shadow:
                0 28px 70px rgba(0,0,0,.50),
                0 0 0 1px rgba(255,255,255,.02),
                0 0 34px rgba(124,92,255,.10) !important;
            color:var(--ubg-text) !important;
            font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
            line-height:1.4;
            backdrop-filter:blur(18px);
            -webkit-backdrop-filter:blur(18px);
        }

        .floating-ui *{box-sizing:border-box}

        .floating-ui .handle{
            height:52px !important;
            line-height:52px !important;
            padding:0 108px 0 16px !important;
            background:linear-gradient(135deg,rgba(124,92,255,.24),rgba(61,131,238,.12) 55%,rgba(255,255,255,.035)) !important;
            border-bottom:1px solid rgba(255,255,255,.08) !important;
            border-radius:17px 17px 0 0 !important;
            box-shadow:inset 0 -1px 0 rgba(255,255,255,.025);
            user-select:none;
        }

        .floating-ui .handle:after{
            content:"";
            position:absolute;
            left:16px;
            right:108px;
            bottom:-1px;
            height:2px;
            border-radius:999px;
            background:linear-gradient(90deg,rgba(124,92,255,.95),rgba(61,131,238,.8),transparent);
            opacity:.72;
            pointer-events:none;
        }

        .floating-ui .handle > img{
            width:24px !important;
            height:24px !important;
            margin-right:10px !important;
            border-radius:7px;
            filter:brightness(0) invert(1) drop-shadow(0 0 8px rgba(255,255,255,.18)) !important;
        }

        .floating-ui .handle > span{
            font-size:1.03em !important;
            font-weight:800 !important;
            letter-spacing:.15px;
            color:#fff !important;
            text-shadow:0 1px 16px rgba(124,92,255,.24);
        }

        .floating-ui .handle > span span{
            font-size:.67em !important;
            font-weight:600 !important;
            color:rgba(255,255,255,.55) !important;
        }

        .floating-ui .ui-close,
        .floating-ui .ui-minimize{
            width:38px !important;
            height:38px !important;
            top:7px !important;
            border:1px solid rgba(255,255,255,.09) !important;
            border-radius:10px !important;
            transition:transform .16s ease,box-shadow .16s ease,filter .16s ease !important;
            z-index:2;
        }

        .floating-ui .ui-close{
            right:8px !important;
            background:rgba(255,77,77,.86) !important;
            box-shadow:0 6px 16px rgba(255,77,77,.12);
        }

        .floating-ui .ui-minimize{
            right:52px !important;
            background:rgba(255,255,255,.07) !important;
            color:rgba(255,255,255,.84) !important;
        }

        .floating-ui .ui-close:hover,
        .floating-ui .ui-minimize:hover{
            transform:translateY(-1px);
            filter:brightness(1.1);
            box-shadow:0 8px 20px rgba(0,0,0,.24);
        }

        .floating-ui .ui-section-title{
            margin:18px 18px 9px !important;
            text-align:left !important;
            font-size:.74rem !important;
            line-height:1.2 !important;
            font-weight:800 !important;
            letter-spacing:1.25px !important;
            color:#b8c3d9 !important;
            text-shadow:none !important;
        }

        .floating-ui .pin-banner{
            width:calc(100% - 28px) !important;
            min-height:46px;
            margin:0 14px 12px !important;
            padding:9px 10px !important;
            border-radius:12px !important;
            border:1px solid rgba(47,128,255,.27) !important;
            box-shadow:0 10px 24px rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.035);
        }

        .floating-ui .pin-banner-info{
            font-size:.75em !important;
            line-height:1.35;
            font-weight:600;
        }

        .floating-ui .pin-badge{
            padding:5px 9px !important;
            border-radius:999px !important;
            letter-spacing:.4px;
            box-shadow:0 4px 12px rgba(25,118,210,.20);
        }

        .floating-ui .input-area{
            width:calc(100% - 28px) !important;
            margin:0 14px 14px !important;
        }

        .floating-ui .input-area input[type="text"]{
            width:100% !important;
            height:42px !important;
            padding:0 14px !important;
            border:1px solid rgba(255,255,255,.10) !important;
            border-radius:12px !important;
            font-size:.88em !important;
            box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 8px 20px rgba(0,0,0,.10);
            transition:border-color .18s ease,box-shadow .18s ease !important;
        }

        .floating-ui .input-area input[type="text"]::placeholder{
            color:rgba(208,216,235,.45);
        }

        .floating-ui .input-area input[type="text"]:hover{
            border-color:rgba(255,255,255,.17) !important;
        }

        .floating-ui .input-area input[type="text"]:focus{
            border-color:rgba(124,92,255,.72) !important;
            box-shadow:0 0 0 3px rgba(124,92,255,.13),inset 0 1px 0 rgba(255,255,255,.04) !important;
        }

        .floating-ui .button-row{
            gap:8px !important;
            margin-top:9px !important;
        }

        .floating-ui .button-row button{
            min-height:40px !important;
            border:1px solid rgba(255,255,255,.075) !important;
            border-radius:10px !important;
            box-shadow:0 7px 18px rgba(0,0,0,.15),inset 0 1px 0 rgba(255,255,255,.035);
            font-weight:700 !important;
            transition:transform .16s ease,box-shadow .16s ease,filter .16s ease !important;
        }

        .floating-ui .button-row button:hover{
            transform:translateY(-1px);
            filter:brightness(1.07);
            box-shadow:0 10px 22px rgba(0,0,0,.21),inset 0 1px 0 rgba(255,255,255,.05);
        }

        .floating-ui .button-row button:active{
            transform:translateY(0);
        }

        .floating-ui .answering-panel{
            width:calc(100% - 28px) !important;
            margin:6px 14px 12px !important;
            padding:14px !important;
            border:1px solid rgba(255,255,255,.065);
            border-radius:14px;
            background:linear-gradient(180deg,rgba(255,255,255,.032),rgba(255,255,255,.015));
            box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
        }

        .floating-ui .toggle-row{
            margin-bottom:14px !important;
            padding:2px 2px 12px;
            border-bottom:1px solid rgba(255,255,255,.065);
        }

        .floating-ui .toggle-row > div{
            padding:7px 10px;
            border:1px solid rgba(255,255,255,.045);
            border-radius:10px;
            background:rgba(255,255,255,.022);
            box-shadow:inset 0 1px 0 rgba(255,255,255,.018);
        }

        .floating-ui .toggle-row span{
            color:#e9edfa !important;
            font-weight:700;
            letter-spacing:.1px;
        }

        .floating-ui .switch{
            width:42px !important;
            height:22px !important;
        }

        .floating-ui .switch .slider{
            border:1px solid rgba(255,255,255,.08);
            box-shadow:inset 0 1px 2px rgba(0,0,0,.25);
        }

        .floating-ui .switch .slider:before{
            box-shadow:0 2px 6px rgba(0,0,0,.26);
        }

        .floating-ui .score-control{
            width:100% !important;
            margin:0 auto !important;
        }

        .floating-ui .score-control > span{
            margin-bottom:8px !important;
            font-size:.78em !important;
            font-weight:700;
            color:#aeb8cf !important;
            letter-spacing:.08px;
        }

        .floating-ui .custom-slider{
            height:9px !important;
            border-radius:999px !important;
            background:#242b3c !important;
            box-shadow:inset 0 1px 3px rgba(0,0,0,.25);
        }

        .floating-ui .custom-slider::-webkit-slider-runnable-track{
            height:9px !important;
            background:linear-gradient(90deg,#5f43d8,#3f84ef) !important;
            border-radius:999px;
        }

        .floating-ui .custom-slider::-webkit-slider-thumb{
            width:19px !important;
            height:19px !important;
            margin-top:-5px !important;
            box-shadow:0 3px 10px rgba(0,0,0,.28),0 0 0 3px rgba(124,92,255,.10);
        }

        .floating-ui .custom-slider::-moz-range-track{
            height:9px !important;
            background:linear-gradient(90deg,#5f43d8,#3f84ef) !important;
            border-radius:999px;
        }

        .floating-ui .custom-slider::-moz-range-thumb{
            width:19px !important;
            height:19px !important;
            box-shadow:0 3px 10px rgba(0,0,0,.28),0 0 0 3px rgba(124,92,255,.10);
        }

        .floating-ui .question-status{
            width:fit-content;
            margin:0 auto 8px !important;
            padding:5px 11px !important;
            border:1px solid rgba(255,255,255,.07);
            border-radius:999px;
            background:rgba(255,255,255,.035);
            color:#c9d2e6 !important;
            font-size:.74em !important;
            font-weight:700;
            letter-spacing:.25px;
            box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
        }

        .floating-ui .game-pin-row{
            width:calc(100% - 28px) !important;
            margin:0 14px 10px !important;
            padding:10px 12px;
            justify-content:space-between !important;
            border:1px solid rgba(255,255,255,.065);
            border-radius:12px;
            background:rgba(255,255,255,.024);
        }

        .floating-ui .game-pin-row > span{
            color:#aeb8cf !important;
            font-size:.77em !important;
            font-weight:700;
            letter-spacing:.2px;
        }

        .floating-ui .game-pin-box{
            min-width:88px !important;
            max-width:150px !important;
            padding:5px 9px !important;
            border-radius:9px !important;
            border:1px solid rgba(255,255,255,.08) !important;
            box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
        }

        .floating-ui .game-pin-box:hover{
            box-shadow:0 0 0 3px rgba(47,128,255,.09),inset 0 1px 0 rgba(255,255,255,.04);
        }

        .floating-ui .questions-panel{
            width:calc(100% - 28px) !important;
            margin:0 14px 12px !important;
        }

        .floating-ui .questions-panel-header{
            padding:10px 12px !important;
            border-radius:11px !important;
            border:1px solid rgba(255,255,255,.075) !important;
            box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
            transition:transform .16s ease,box-shadow .16s ease !important;
        }

        .floating-ui .questions-panel-header:hover{
            transform:translateY(-1px);
            box-shadow:0 8px 18px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.035);
        }

        .floating-ui .questions-panel-content{
            border-color:rgba(255,255,255,.07) !important;
            border-radius:11px !important;
        }

        .floating-ui .question-list{
            padding:8px !important;
        }

        .floating-ui .question-item{
            margin-bottom:8px !important;
            border:1px solid rgba(255,255,255,.065) !important;
            border-radius:11px !important;
            background:rgba(255,255,255,.018);
            box-shadow:inset 0 1px 0 rgba(255,255,255,.02);
        }

        .floating-ui .question-header{
            padding:10px 11px !important;
            border-radius:10px;
        }

        .floating-ui .question-content{
            border-top-color:rgba(255,255,255,.065) !important;
        }

        .floating-ui .search-dropdown{
            border:1px solid rgba(255,255,255,.09) !important;
            border-radius:12px !important;
            box-shadow:0 18px 36px rgba(0,0,0,.30);
            backdrop-filter:blur(14px);
            -webkit-backdrop-filter:blur(14px);
        }

        .floating-ui .search-dropdown-header{
            border-bottom:1px solid rgba(255,255,255,.06);
        }

        .floating-ui .search-dropdown button{
            border-radius:9px !important;
        }

        .floating-ui .links-section{
            margin:14px 14px 4px !important;
            padding:12px 14px !important;
            border:1px solid rgba(255,255,255,.065);
            border-radius:14px;
            background:linear-gradient(180deg,rgba(255,255,255,.028),rgba(255,255,255,.014));
            box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
        }

        .floating-ui .links-section > div{
            padding:8px 2px;
            border-bottom:1px solid rgba(255,255,255,.05);
        }

        .floating-ui .links-section > div:last-child{
            border-bottom:none;
        }

        .floating-ui .links-section a{
            opacity:.86;
            transition:transform .16s ease,opacity .16s ease,filter .16s ease;
        }

        .floating-ui .links-section a:hover{
            opacity:1;
            transform:translateY(-1px);
            filter:drop-shadow(0 0 6px rgba(124,92,255,.28));
        }

        .floating-ui .role-badge{
            box-shadow:0 3px 10px rgba(0,0,0,.14);
            border:1px solid rgba(255,255,255,.06);
        }

        .floating-ui .owner-credit{
            margin:8px 14px 16px !important;
            padding:12px 10px !important;
            border-top:1px solid rgba(255,255,255,.07) !important;
            border-radius:0 !important;
            color:#8f99b1 !important;
            font-size:.70em !important;
            font-weight:700 !important;
            letter-spacing:.45px !important;
        }

        .floating-ui button{
            font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        }

        .floating-ui button:focus-visible,
        .floating-ui input:focus-visible{
            outline:none;
        }

        .floating-ui *::-webkit-scrollbar{
            width:7px !important;
            height:7px !important;
        }

        .floating-ui *::-webkit-scrollbar-track{
            background:transparent !important;
        }

        .floating-ui *::-webkit-scrollbar-thumb{
            background:rgba(126,138,168,.34) !important;
            border:2px solid transparent !important;
            background-clip:padding-box !important;
            border-radius:999px !important;
        }

        .floating-ui *::-webkit-scrollbar-thumb:hover{
            background:rgba(153,166,199,.52) !important;
            background-clip:padding-box !important;
        }

        .floating-ui *{
            scrollbar-width:thin;
            scrollbar-color:rgba(126,138,168,.42) transparent;
        }

        @media(max-width:768px){
            .floating-ui{
                width:calc(100vw - 24px) !important;
                max-width:calc(100vw - 24px) !important;
                left:12px !important;
                top:3% !important;
                max-height:92vh !important;
            }

            .floating-ui .handle{
                padding-left:13px !important;
                padding-right:100px !important;
            }

            .floating-ui .handle:after{
                left:13px;
                right:100px;
            }

            .floating-ui .ui-close,
            .floating-ui .ui-minimize{
                width:36px !important;
                height:36px !important;
                top:8px !important;
            }

            .floating-ui .ui-close{right:7px !important}
            .floating-ui .ui-minimize{right:49px !important}

            .floating-ui .answering-panel,
            .floating-ui .input-area,
            .floating-ui .questions-panel,
            .floating-ui .game-pin-row,
            .floating-ui .links-section{
                width:calc(100% - 20px) !important;
                margin-left:10px !important;
                margin-right:10px !important;
            }
        }
    ` }));

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