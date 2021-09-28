// @flow

import Spinner from '@atlaskit/spinner';

import React, { Component } from 'react';
import type { Dispatch } from 'redux';
import { connect } from 'react-redux';
import { push } from 'react-router-redux';

import i18n from '../../../i18n';
import config from '../../config';
import { getSetting } from '../../settings';

import JitsiMeetExternalAPI from '../external_api';
import { LoadingIndicator, Wrapper } from '../styled';
import { createConferenceObjectFromURL, getServerURL } from '../../utils';
import Loading from '../../always-on-top/Loading';

const electron = window.require('electron');
const os = window.require('os');
const { BrowserWindow } = electron.remote

const ENABLE_REMOTE_CONTROL = false;

type Props = {

    /**
     * Redux dispatch.
     */
    dispatch: Dispatch<*>;

    /**
     * React Router location object.
     */
    location: Object;

    /**
     * AlwaysOnTop Window Enabled.
     */
    _alwaysOnTopWindowEnabled: boolean;

    /**
     * Default Jitsi Server URL.
     */
    _serverURL: string;

    /**
     * Default Jitsi Server Timeout.
     */
    _serverTimeout: number;
};

type State = {

    /**
     * If the Home is loading or not.
     */
    isLoading: boolean;

    loadingMsg: string;
};

/**
 * Home component.
 */
class Home extends Component<Props, State> {
    /**
     * External API object.
     */
    _api: Object;

    /**
     * Timer to cancel the joining if it takes too long.
     */
    _loadTimer: ?TimeoutID;

    /**
     * Reference to the element of this component.
     */
    _ref: Object;

    /**
     * Initializes a new {@code Home} instance.
     *
     * @inheritdoc
     */
    constructor() {
        super();

        this.state = {
            isLoading: true,
            loadingMsg: ''
        };

        this._ref = React.createRef();

        this._onIframeLoad = this._onIframeLoad.bind(this);
        this._onExplicitIframeReload = this._onExplicitIframeReload.bind(this);
        this._updateAppBadge = this._updateAppBadge.bind(this);
    }

    /**
     * Attach the script to this component.
     *
     * @returns {void}
     */
    componentDidMount() {
        const serverTimeout = this.props._serverTimeout || config.defaultServerTimeout;
        const serverURL = /*(this.props.location.state && this.props.location.state.serverURL)
            || this.props._serverURL
            || */ getServerURL();
        let homePageParams = "";
        if(this.props.location && this.props.location.state) {

            if(this.props.location.state.actions) {
                homePageParams += `actions=${this.props.location.state.actions}&`
            }
            if(this.props.location.state.home) {
                homePageParams += `home=${this.props.location.state.home}&`
            }
            if(this.props.location.state.invalidMeetingId) {
                homePageParams += `invalidMeetingId=${this.props.location.state.invalidMeetingId}&`
            }

            if(this.props.location.state.loadingMsg) {
                this.setState({
                    loadingMsg: this.props.location.state.loadingMsg
                });
            }
            
        }
        this._loadHome(`${serverURL}${homePageParams ? '?' + homePageParams: ''}`);
    }

    /**
     * Remove Home on unmounting.
     *
     * @returns {void}
     */
    componentWillUnmount() {
        if (this._loadTimer) {
            clearTimeout(this._loadTimer);
        }
        if (this._api) {
            this._api.dispose();
        }
    }

    _updateAppBadge: (*) => void;

    _updateAppBadge({showBadge}) {
        if(os.platform() === "win32") {
            electron.remote?.ipcRenderer?.sendSync('update-badge', showBadge ? "•": null)
        }
        else {
            electron.remote?.app?.dock?.setBadge(showBadge ? "•": "");
        }
    }

    _onExplicitIframeReload: (*) => void;

    /**
     * Reload iframe with new iframe URL.
     *
     * @param {Object} obj - data with serverURL in it.
     * @returns {void}
     * @private
     */
    _onExplicitIframeReload(obj: Object) {
        let data = obj.config;
        
        let pathConfig;
        if(data.room) {
            pathConfig = createConferenceObjectFromURL(
                getServerURL() + '/' + data.room);
        }
        else {
            pathConfig = data.options || {};
        }

        if (data.loadingMsg) {
            Object.assign(pathConfig, { loadingMsg: data.loadingMsg});
            this.setState({
                loadingMsg: data.loadingMsg
            })
        }

        if (!pathConfig) {
            return;
        }

        // console.log("this.props.dispatch: ", this.props.dispatch);
        let path = data.room ? '/conference': '/';
        this.props.dispatch(push('/temp'));
        this.props.dispatch(push(path, pathConfig));
    }

    /**
     * Implements React's {@link Component#render()}.
     *
     * @returns {ReactElement}
     */
    render() {
        return (
            <Wrapper innerRef = { this._ref }>
                { this._maybeRenderLoadingIndicator() }
            </Wrapper>
        );
    }

    /**
     * Load the Home by creating the iframe element in this component
     * and attaching utils from jifmeet-electron-utils.
     *
     * @returns {void}
     */
    _loadHome(serverURL) {
        //ask for screenshare permission once done it wont be asked again
        //window.jitsiNodeAPI.ipc.send('explicit-screenshare-init');

        const url = new URL(serverURL);
        const host = serverURL.replace(/https?:\/\//, '');
        const searchParameters = Object.fromEntries(url.searchParams);
        const locale = { lng: i18n.language };
        const urlParameters = {
            ...searchParameters,
            ...locale
        };

        const options = {
            onload: this._onIframeLoad,
            parentNode: this._ref.current,
        };

        this._api = new JitsiMeetExternalAPI(host, {
            ...options,
            ...urlParameters
        });

        this._api.on('explicitIframeReload', this._onExplicitIframeReload);

        this._api.on('updateAppBadge', this._updateAppBadge);

        // start listening on this events
        this._api.on('liveMessage', ({
                from,
                id,
                message,
                stamp,
                isChatOpen
            }) => {
                const [mainWindow] = BrowserWindow.getAllWindows();

                if(!mainWindow.isFocused() || !isChatOpen) {
                    new Notification(`${from || ''}`, {
                        body: message
                    });
                }
        });

        const { RemoteControl,
            setupScreenSharingRender,
            setupAlwaysOnTopRender,
            initPopupsConfigurationRender,
            setupWiFiStats,
            setupPowerMonitorRender
        } = window.jitsiNodeAPI.jitsiMeetElectronUtils;

        initPopupsConfigurationRender(this._api);

        const iframe = this._api.getIFrame();

        setupScreenSharingRender(this._api);

        if (ENABLE_REMOTE_CONTROL) {
            new RemoteControl(iframe); // eslint-disable-line no-new
        }

        // Allow window to be on top if enabled in settings
        if (this.props._alwaysOnTopWindowEnabled) {
            setupAlwaysOnTopRender(this._api);
        }

        setupWiFiStats(iframe);
        setupPowerMonitorRender(this._api);
    }

    /**
     * It renders a loading indicator, if appropriate.
     *
     * @returns {?ReactElement}
     */
    _maybeRenderLoadingIndicator() {
        if (this.state.isLoading) {
            return (
                <LoadingIndicator>
                    <Loading message={this.state.loadingMsg} />
                </LoadingIndicator>
            );
        }
    }

    _onIframeLoad: (*) => void;

    /**
     * Sets state of loading to false when iframe has completely loaded.
     *
     * @returns {void}
     */
    _onIframeLoad() {
        if (this._loadTimer) {
            clearTimeout(this._loadTimer);
            this._loadTimer = null;
        }

        this.setState({
            isLoading: false
        });
    }
}

/**
 * Maps (parts of) the redux state to the React props.
 *
 * @param {Object} state - The redux state.
 * @returns {Props}
 */
function _mapStateToProps(state: Object) {
    return {
        _alwaysOnTopWindowEnabled: getSetting(state, 'alwaysOnTopWindowEnabled', true),
        _serverURL: state.settings.serverURL,
        _serverTimeout: state.settings.serverTimeout,
    };
}

export default connect(_mapStateToProps)(Home);
