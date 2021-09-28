/* global process */

import config from "../config";

const {
    initPopupsConfigurationMain,
    getPopupTarget,
    setupAlwaysOnTopMain,
    setupPowerMonitorMain,
    setupScreenSharingMain
} = window.require('jifmeet-electron-utils');

const windowStateKeeper = window.require('electron-window-state');

// @flow


/**
 * Return true if Electron app is running on Mac system.
 *
 * @returns {boolean}
 */
export function isElectronMac() {
    return process.platform === 'darwin';
}

/**
 * Normalizes the given server URL so it has the proper scheme.
 *
 * @param {string} url - URL with or without scheme.
 * @returns {string}
 */
export function normalizeServerURL(url: string) {
    // eslint-disable-next-line no-param-reassign
    url = url.trim();

    if (url && url.indexOf('://') === -1) {
        return `https://${url}`;
    }

    return url;
}

/**
 * Opens the provided link in default broswer.
 *
 * @param {string} link - Link to open outside the desktop app.
 * @returns {void}
 */
export function openExternalLink(link: string) {
    window.jitsiNodeAPI.openExternalLink(link);
}

/**
 * Returns the entire settings object from window.localStorage
 * @returns {Object}
 */
export function getSettings() {
    return JSON.parse(window.localStorage.getItem('settingDetail') || "{}");
}

/**
 * Returns the serverURL to use
 * @returns {Object}
 */
export function getServerURL() {
    let baseUrl = getSettings().serverUrl || config.defaultServerURL;
    return baseUrl;
}

/**
 * Get URL, extract room name from it and create a Conference object.
 *
 * @param {string} inputURL - Combined server url with room separated by /.
 * @returns {Object}
 */
export function createConferenceObjectFromURL(inputURL: string) {
    const lastIndexOfSlash = inputURL.lastIndexOf('/');
    let room;
    let serverURL;

    if (lastIndexOfSlash === -1) {
        // This must be only the room name.
        room = inputURL;
    } else {
        // Take the substring after last slash to be the room name.
        room = inputURL.substring(lastIndexOfSlash + 1);

        // Take the substring before last slash to be the Server URL.
        serverURL = inputURL.substring(0, lastIndexOfSlash);

        // Normalize the server URL.
        serverURL = normalizeServerURL(serverURL);
    }

    // Don't navigate if no room was specified.
    if (!room) {
        return;
    }

    return {
        room,
        serverURL
    };
}

export function createMeetingWindow(data) {
    const electron = window.require('electron');
    const { BrowserWindow, ipcMain } = electron.remote;
    const [mainWindow] = BrowserWindow.getAllWindows();

    // Load the previous window state with fallback to defaults.
    const windowState = windowStateKeeper({
        defaultWidth: 1220,
        defaultHeight: 800
    });

    const options = {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        // icon: path.resolve(basePath, './resources/icon.png'),
        minWidth: 1220,
        minHeight: 800,
        show: false,
        webPreferences: {
            enableBlinkFeatures: 'RTCInsertableStreams',
            enableRemoteModule: true,
            nativeWindowOpen: true,
            nodeIntegration: true,
            preload: mainWindow.webContents.getWebPreferences().preload
        }
    };

    
    //window.open('https://dev-jifmeet.saal.ai/67-1621754475599-363#config.prejoinPageEnabled=false')
    const child = new BrowserWindow(Object.assign({}, options, { parent: mainWindow }));
    windowState.manage(child);
    child.show()
    child.loadURL(mainWindow.getURL()/*, `${config.defaultServerURL}/${data.meetingID}#config.prejoinPageEnabled=false`*/);
    setupAlwaysOnTopMain(child);
    setupPowerMonitorMain(child);
    setupScreenSharingMain.setup(child, config.appName, 'com.jifmeet.meet.desktopapp');

    child.webContents.on('new-window', (event, url, frameName) => {
        const target = getPopupTarget(url, frameName);

        if (!target || target === 'browser') {
            event.preventDefault();
            openExternalLink(url);
        }
    });

    let rendererReady = false;
    /**
     * This is to notify main.js [this] that front app is ready to receive messages.
     */
    ipcMain.on('renderer-ready', () => {
        rendererReady = true;
        child
            .webContents
            .send('protocol-data-msg', `${data.meetingID}#config.prejoinPageEnabled=false`);
    });
}
