// Native Node Imports
const url = require('url');
const path = require('path');
const Discord = require('discord.js');
const express = require('express');
const app = express();
const moment = require('moment');
require('moment-duration-format');
const passport = require('passport');

const Strategy = require('passport-discord').Strategy;
const helmet = require('helmet');
const md = require('marked');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo')(session);

module.exports = client => {
  // It's easier to deal with complex paths.
  // This resolves to: yourbotdir/dashboard/
  const dataDir = path.resolve(`${process.cwd()}${path.sep}routes`);

  // This resolves to: yourbotdir/dashboard/templates/
  // which is the folder that stores all the internal template files.
  const templateDir = path.resolve(`${dataDir}${path.sep}views`);

  // The public data directory, which is accessible from the *browser*.
  // It contains all css, client javascript, and images needed for the site.
  app.use(
    '/assets',
    express.static(path.resolve(`${templateDir}${path.sep}assets`))
  );

  // These are... internal things related to passport. Honestly I have no clue either.
  // Just leave 'em there.
  passport.serializeUser((user, done) => {
    done(null, user);
  });
  passport.deserializeUser((obj, done) => {
    done(null, obj);
  });

  /* 
  This defines the **Passport** oauth2 data. A few things are necessary here.
  
  clientID = Your bot's client ID, at the top of your app page. Please note, 
    older bots have BOTH a client ID and a Bot ID. Use the Client one.
  clientSecret: The secret code at the top of the app page that you have to 
    click to reveal. Yes that one we told you you'd never use.
  callbackURL: The URL that will be called after the login. This URL must be
    available from your PC for now, but must be available publically if you're
    ever to use this dashboard in an actual bot. 
  scope: The data scopes we need for data. identify and guilds are sufficient
    for most purposes. You might have to add more if you want access to more
    stuff from the user. See: https://discordapp.com/developers/docs/topics/oauth2 

  See config.js.example to set these up. 
  */

  passport.use(
    new Strategy(
      {
        clientID: client.settings.tokens.clID,
        clientSecret: client.settings.tokens.clse,
        callbackURL: client.settings.tokens.cbUrl,
        scope: ['identify', 'guilds']
      },
      (accessToken, refreshToken, profile, done) => {
        process.nextTick(() => done(null, profile));
      }
    )
  );

  // Session data, used for temporary storage of your visitor's session information.
  // the `secret` is in fact a "salt" for the data, and should not be shared publicly.

  mongoose.connect(
    client.settings.tokens.mlabs,
    {
      useNewUrlParser: true
    }
  );
  const db = mongoose.connection;

  app.use(cookieParser());

  app.use(
    session({
      secret: 'my-secret',
      resave: false,
      saveUninitialized: true,
      store: new MongoStore({ mongooseConnection: db })
    })
  );

  // Initializes passport and session.
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(helmet());

  // The domain name used in various endpoints to link between pages.
  app.locals.domain = client.settings.tokens.domain;

  // The EJS templating engine gives us more power to create complex web pages.
  // This lets us have a separate header, footer, and "blocks" we can use in our pages.
  app.engine('html', require('ejs').renderFile);
  app.set('view engine', 'html');

  app.use(express.json()); // to support JSON-encoded bodies
  app.use(
    express.urlencoded({
      // to support URL-encoded bodies
      extended: true
    })
  );

  /* 
  Authentication Checks. For each page where the user should be logged in, double-checks
  whether the login is valid and the session is still active.
  */
  function checkAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.session.backURL = req.url;
    res.redirect('/login');
  }

  // This function simplifies the rendering of the page, since every page must be rendered
  // with the passing of these 4 variables, and from a base path.
  // Objectassign(object, newobject) simply merges 2 objects together, in case you didn't know!
  const renderTemplate = (res, req, template, data = {}) => {
    const baseData = {
      bot: client,
      path: req.path,
      user: req.isAuthenticated() ? req.user : null,
      avatar: req.isAuthenticated()
        ? client.users.get(req.user.id).avatarURL
        : null
    };
    res.render(
      path.resolve(`${templateDir}${path.sep}${template}`),
      Object.assign(baseData, data)
    );
  };

  /** PAGE ACTIONS RELATED TO SESSIONS */

  // The login page saves the page the person was on in the session,
  // then throws the user to the Discord OAuth2 login page.
  app.get(
    '/login',
    (req, res, next) => {
      if (req.session.backURL) {
        req.session.backURL = req.session.backURL;
      } else if (req.headers.referer) {
        const parsed = url.parse(req.headers.referer);
        if (parsed.hostname === app.locals.domain) {
          req.session.backURL = parsed.path;
        }
      } else {
        req.session.backURL = '/';
      }
      next();
    },
    passport.authenticate('discord')
  );

  // Once the user returns from OAuth2, this endpoint gets called.
  // Here we check if the user was already on the page and redirect them
  // there, mostly.
  app.get(
    '/callback',
    passport.authenticate('discord', { failureRedirect: '/autherror' }),
    (req, res) => {
      client.logger.log(`${req.user.username} logged into the dashboard`);
      if (client.settings.admins.includes(req.user.username)) {
        req.session.isAdmin = true;
      } else {
        req.session.isAdmin = false;
      }
      if (req.session.backURL) {
        const url = req.session.backURL;
        req.session.backURL = null;
        res.redirect(url);
      } else {
        res.redirect('/dashboard');
      }
    }
  );

  // If an error happens during authentication, this is what's displayed.
  app.get('/autherror', (req, res) => {
    renderTemplate(res, req, 'pages/autherror.ejs');
  });

  // Destroys the session to log out the user.
  app.get('/logout', function(req, res) {
    req.session.destroy(() => {
      req.logout();
      res.redirect('/'); //Inside a callback… bulletproof!
    });
  });

  /** REGULAR INFORMATION PAGES */

  // Index page. If the user is authenticated, it shows their info
  // at the top right of the screen.
  app.get('/', (req, res) => {
    renderTemplate(res, req, '/pages/index.ejs');
  });

  // The list of commands the bot has. Current **not filtered** by permission.
  app.get('/commands', (req, res) => {
    renderTemplate(res, req, 'pages/commands.ejs', { md });
  });

  app.get('/api', (req, res) => {
    renderTemplate(res, req, 'pages/api.ejs', { md });
  });

  // Bot statistics. Notice that most of the rendering of data is done through this code,
  // not in the template, to simplify the page code. Most of it **could** be done on the page.
  app.get('/stats', (req, res) => {
    const duration = moment.duration(client.uptime).format('DD:HH:mm:ss');
    let durLabel;
    if (duration.length === 2) durLabel = ' Seconds';
    if (duration.length === 5) durLabel = ' Minutes';
    if (duration.length === 8) durLabel = ' Hours';
    if (duration.length === 11) durLabel = ' Days';

    const members = client.guilds.reduce((p, c) => p + c.memberCount, 0);
    const textChannels = client.channels.filter(c => c.type === 'text').size;
    const voiceChannels = client.channels.filter(c => c.type === 'voice').size;
    const guilds = client.guilds.size;
    renderTemplate(res, req, 'pages/stats.ejs', {
      stats: [
        ['Servers', 'fa fa-fw fa-server', guilds],
        ['Members', 'fa fa-fw fa-users', members],
        ['Text Channels', 'fa fa-fw fa-hashtag', textChannels],
        ['Voice Channels', 'fa fa-fw fa-microphone', voiceChannels],
        [`${durLabel} Uptime`, 'far fa-clock', duration],
        [
          'Memory Usage',
          'fa fa-fw fa-tasks',
          (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) +
            "<span class='memUsage'>MB</span>"
        ],
        ['Discord.JS Version', 'fab fa-discord', Discord.version],
        ['NPM Version', 'fab fa-npm', process.version]
      ]
    });
  });

  app.get('/invite', checkAuth, (req, res) => {
    const perms = Discord.EvaluatedPermissions;
    renderTemplate(res, req, 'pages/invite.ejs', { perms });
  });

  app.get('/dashboard', checkAuth, (req, res) => {
    const perms = Discord.EvaluatedPermissions;
    renderTemplate(res, req, '/pages/dashboard.ejs', { perms });
  });

  app.get('/botadmin', checkAuth, (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/dashboard');
    renderTemplate(res, req, 'pages/botAdmin.ejs');
  });

  // The Admin dashboard is similar to the one above, with the exception that
  // it shows all current guilds the bot is on, not *just* the ones the user has
  // access to. Obviously, this is reserved to the bot's owner for security reasons.
  app.get('/admin', checkAuth, (req, res) => {
    const perms = Discord.EvaluatedPermissions;
    renderTemplate(res, req, 'pages/admin.ejs', { perms });
  });

  // Simple redirect to the "Settings" page (aka "manage")
  app.get('/dashboard/:guildID', checkAuth, (req, res) => {
    res.redirect(`/dashboard/${req.params.guildID}/manage`);
  });

  // Settings page to change the guild configuration. Definitely more fancy than using
  // the `set` command!
  app.get('/dashboard/:guildID/manage', checkAuth, (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged =
      guild && !!guild.member(req.user.id)
        ? guild.member(req.user.id).permissions.has('MANAGE_GUILD')
        : false;
    if (!isManaged && !req.session.isAdmin) res.redirect('/');
    renderTemplate(res, req, 'pages/manage.ejs', { guild, moment: moment });
  });

  // When a setting is changed, a POST occurs and this code runs
  // Once settings are saved, it redirects back to the settings page.
  app.post('/dashboard/:guildID/manage', checkAuth, (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged =
      guild && !!guild.member(req.user.id)
        ? guild.member(req.user.id).permissions.has('MANAGE_GUILD')
        : false;
    if (!isManaged && !req.session.isAdmin) res.redirect('/');
    client.writeSettings(guild.id, req.body);
    res.redirect('/dashboard/' + req.params.guildID + '/manage');
  });

  // Displays the list of members on the guild (paginated).
  // NOTE: to be done, merge with manage and stats in a single UX page.
  app.get('/dashboard/:guildID/members', checkAuth, async (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    const mArray = [];
    guild.members.array().forEach(m => {
      let user = {};
      user.details = [m.user.username, m.user.id, m.nickname];
      user.bot = m.user.bot;
      user.joined = m.joinedTimestamp;
      user.avatar = client.users.get(m.user.id).avatarURL;
      user.rank = [m.highestRole, m.highestRole.hexColor];

      let roles = [];
      m.roles
        .filter(r => r.name !== '@everyone')
        .map(r => {
          roles.push({ name: r.name, pos: r.position, col: r.hexColor });
        });
      user.roles = roles;

      mArray.push(user);
    });

    if (!guild) return res.status(404);
    renderTemplate(res, req, 'pages/guild-members.ejs', {
      guild: guild,
      members: mArray
    });
  });

  // Channel Listing
  app.get('/dashboard/:guildID/c', checkAuth, async (req, res) => {
    const guild = client.guilds.get(req.params.guildID);

    let cateObj = [];

    const sort = data => {
      data.sort(function(a, b) {
        return a.position - b.position;
      });
    };

    guild.channels.forEach(c => {
      if (c.type === 'category') {
        let chans = guild.channels
          .filter(chan => chan.parentID === c.id)
          .map(chan => ({
            name: chan.name,
            id: chan.id,
            position: chan.position,
            topic: chan.topic,
            type: chan.type
          }));
        sort(chans);
        cateObj.push({
          name: c.name,
          id: c.id,
          position: c.position,
          channels: chans
        });
      }
    });

    sort(cateObj);

    renderTemplate(res, req, 'pages/channels.ejs', {
      cats: cateObj
    });
  });

  // This JSON endpoint retrieves a partial list of members. This list can
  // be filtered, sorted, and limited to a partial count (for pagination).
  // NOTE: This is the most complex endpoint simply because of this filtering
  // otherwise it would be on the client side and that would be horribly slow.
  app.get('/dashboard/:guildID/members/list', checkAuth, async (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    if (req.query.fetch) {
      await guild.fetchMembers();
    }
    const totals = guild.members.size;
    const start = parseInt(req.query.start, 10) || 0;
    const limit = parseInt(req.query.limit, 10) || 50;
    let members = guild.members;

    if (req.query.filter && req.query.filter !== 'null') {
      //if (!req.query.filtervalue) return res.status(400);
      members = members.filter(m => {
        m = req.query.filterUser ? m.user : m;
        return m['displayName']
          .toLowerCase()
          .includes(req.query.filter.toLowerCase());
      });
    }

    if (req.query.sortby) {
      members = members.sort(
        (a, b) => a[req.query.sortby] > b[req.query.sortby]
      );
    }
    const memberArray = members.array().slice(start, start + limit);

    const returnObject = [];
    for (let i = 0; i < memberArray.length; i++) {
      const m = memberArray[i];
      returnObject.push({
        id: m.id,
        status: m.user.presence.status,
        bot: m.user.bot,
        username: m.user.username,
        displayName: m.displayName,
        tag: m.user.tag,
        discriminator: m.user.discriminator,
        joinedAt: m.joinedTimestamp,
        createdAt: m.user.createdTimestamp,
        highestRole: {
          hexColor: m.highestRole.hexColor
        },
        memberFor: moment
          .duration(Date.now() - m.joinedAt)
          .format(' D [days], H [hrs], m [mins], s [secs]'),
        roles: m.roles.map(r => ({
          name: r.name,
          id: r.id,
          hexColor: r.hexColor
        }))
      });
    }
    res.json({
      total: totals,
      page: start / limit + 1,
      pageof: Math.ceil(members.size / limit),
      members: returnObject
    });
  });

  // Displays general guild statistics.
  app.get('/dashboard/:guildID/stats', checkAuth, (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged =
      guild && !!guild.member(req.user.id)
        ? guild.member(req.user.id).permissions.has('MANAGE_GUILD')
        : false;
    if (!isManaged && !req.session.isAdmin) res.redirect('/');
    renderTemplate(res, req, 'pages/guild-stats.ejs', { guild });
  });

  // Displays general guild statistics.
  app.get('/dashboard/:guildID/modules', checkAuth, (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged =
      guild && !!guild.member(req.user.id)
        ? guild.member(req.user.id).permissions.has('MANAGE_GUILD')
        : false;
    if (!isManaged && !req.session.isAdmin) res.redirect('/');
    renderTemplate(res, req, 'pages/guild-modules.ejs', { guild });
  });

  // Leaves the guild (this is triggered from the manage page, and only
  // from the modal dialog)
  app.get('/dashboard/:guildID/leave', checkAuth, async (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged =
      guild && !!guild.member(req.user.id)
        ? guild.member(req.user.id).permissions.has('MANAGE_GUILD')
        : false;
    if (!isManaged && !req.session.isAdmin) res.redirect('/');
    await guild.leave();
    res.redirect('/dashboard');
  });

  // Resets the guild's settings to the defaults, by simply deleting them.
  app.get('/dashboard/:guildID/reset', checkAuth, async (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged =
      guild && !!guild.member(req.user.id)
        ? guild.member(req.user.id).permissions.has('MANAGE_GUILD')
        : false;
    if (!isManaged && !req.session.isAdmin) res.redirect('/');
    client.settings.delete(guild.id);
    res.redirect('/dashboard/' + req.params.guildID);
  });

  client.site = app.listen(8003);
};
