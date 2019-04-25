// @remove-file-on-eject
/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on('unhandledRejection', err => {
  throw err;
});

const fs = require('fs-extra');
const path = require('path');
const chalk = require('react-dev-utils/chalk');
const execSync = require('child_process').execSync;
const spawn = require('react-dev-utils/crossSpawn');
const { exec } = require('child_process');
const readline = require('readline');
const _ = require('lodash');
const { defaultBrowsers } = require('react-dev-utils/browsersHelper');
const os = require('os');
const verifyTypeScriptSetup = require('./utils/verifyTypeScriptSetup');

_.templateSettings.interpolate = /<%=([\s\S]+?)%>/g;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function isInGitRepository() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function isInMercurialRepository() {
  try {
    execSync('hg --cwd . root', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function tryGitInit(appPath) {
  let didInit = false;
  try {
    execSync('git --version', { stdio: 'ignore' });
    if (isInGitRepository() || isInMercurialRepository()) {
      return false;
    }

    execSync('git init', { stdio: 'ignore' });
    didInit = true;

    execSync('git add -A', { stdio: 'ignore' });
    execSync('git commit -m "Initial commit from Create React App"', {
      stdio: 'ignore',
    });
    return true;
  } catch (e) {
    if (didInit) {
      // If we successfully initialized but couldn't commit,
      // maybe the commit author config is not set.
      // In the future, we might supply our own committer
      // like Ember CLI does, but for now, let's just
      // remove the Git files to avoid a half-done state.
      try {
        // unlinkSync() doesn't work on directories.
        fs.removeSync(path.join(appPath, '.git'));
      } catch (removeErr) {
        // Ignore.
      }
    }
    return false;
  }
}

module.exports = function(
  appPath,
  appName,
  verbose,
  originalDirectory,
  template
) {
  const ownPath = path.dirname(
    require.resolve(path.join(__dirname, '..', 'package.json'))
  );
  const appPackage = require(path.join(appPath, 'package.json'));
  const useYarn = fs.existsSync(path.join(appPath, 'yarn.lock'));

  // Copy over some of the devDependencies
  appPackage.dependencies = appPackage.dependencies || {};

  const useTypeScript = appPackage.dependencies['typescript'] != null;

  // Setup the script rules
  appPackage.scripts = {
    start: 'react-app-rewired start --scripts-version sendit-react-scripts',
    build: 'react-app-rewired build --scripts-version sendit-react-scripts',
    test:
      'react-app-rewired test --scripts-version sendit-react-scripts --env=jsdom',
    eject: 'react-scripts eject',
    storybook: 'start-storybook -p 6006',
    'build-storybook': 'build-storybook',
  };

  // Setup the eslint config
  appPackage.eslintConfig = {
    extends: 'react-app',
  };

  // Setup the browsers list
  appPackage.browserslist = defaultBrowsers;

  fs.writeFileSync(
    path.join(appPath, 'package.json'),
    JSON.stringify(appPackage, null, 2) + os.EOL
  );

  const readmeExists = fs.existsSync(path.join(appPath, 'README.md'));
  if (readmeExists) {
    fs.renameSync(
      path.join(appPath, 'README.md'),
      path.join(appPath, 'README.old.md')
    );
  }

  // Copy the files for the user
  const templatePath = template
    ? path.resolve(originalDirectory, template)
    : path.join(ownPath, useTypeScript ? 'template-typescript' : 'template');
  if (fs.existsSync(templatePath)) {
    fs.copySync(templatePath, appPath);
  } else {
    console.error(
      `Could not locate supplied template: ${chalk.green(templatePath)}`
    );
    return;
  }

  // Rename gitignore after the fact to prevent npm from renaming it to .npmignore
  // See: https://github.com/npm/npm/issues/1862
  try {
    fs.moveSync(
      path.join(appPath, 'gitignore'),
      path.join(appPath, '.gitignore'),
      []
    );
  } catch (err) {
    // Append if there's already a `.gitignore` file there
    if (err.code === 'EEXIST') {
      const data = fs.readFileSync(path.join(appPath, 'gitignore'));
      fs.appendFileSync(path.join(appPath, '.gitignore'), data);
      fs.unlinkSync(path.join(appPath, 'gitignore'));
    } else {
      throw err;
    }
  }

  let command;
  let args;

  if (useYarn) {
    command = 'yarnpkg';
    args = ['add'];
  } else {
    command = 'npm';
    args = ['install', '--save', verbose && '--verbose'].filter(e => e);
  }
  args.push('react', 'react-dom');

  // Install additional template dependencies, if present
  const templateDependenciesPath = path.join(
    appPath,
    '.template.dependencies.json'
  );
  if (fs.existsSync(templateDependenciesPath)) {
    const templateDependencies = require(templateDependenciesPath).dependencies;
    args = args.concat(
      Object.keys(templateDependencies).map(key => {
        return `${key}@${templateDependencies[key]}`;
      })
    );
    fs.unlinkSync(templateDependenciesPath);
  }

  // Install react and react-dom for backward compatibility with old CRA cli
  // which doesn't install react and react-dom along with react-scripts
  // or template is presetend (via --internal-testing-template)
  if (!isReactInstalled(appPackage) || template) {
    console.log(`Installing react and react-dom using ${command}...`);
    console.log();

    const proc = spawn.sync(command, args, { stdio: 'inherit' });
    if (proc.status !== 0) {
      console.error(`\`${command} ${args.join(' ')}\` failed`);
      return;
    }
  }

  if (useTypeScript) {
    verifyTypeScriptSetup();
  }

  if (tryGitInit(appPath)) {
    console.log();
    console.log('Initialized a git repository.');
  }

  // Display the most elegant way to cd.
  // This needs to handle an undefined originalDirectory for
  // backward compatibility with old global-cli's.
  let cdpath;
  if (originalDirectory && path.join(originalDirectory, appName) === appPath) {
    cdpath = appName;
  } else {
    cdpath = appPath;
  }

  // Change displayed command to yarn instead of yarnpkg
  const displayedCommand = useYarn ? 'yarn' : 'npm';

  console.log();
  console.log(`Success! Created ${appName} at ${appPath}`);
  console.log('Inside that directory, you can run several commands:');
  console.log();
  console.log(chalk.cyan(`  ${displayedCommand} start`));
  console.log('    Starts the development server.');
  console.log();
  console.log(
    chalk.cyan(`  ${displayedCommand} ${useYarn ? '' : 'run '}build`)
  );
  console.log('    Bundles the app into static files for production.');
  console.log();
  console.log(chalk.cyan(`  ${displayedCommand} test`));
  console.log('    Starts the test runner.');
  console.log();
  console.log(
    chalk.cyan(`  ${displayedCommand} ${useYarn ? '' : 'run '}eject`)
  );
  console.log(
    '    Removes this tool and copies build dependencies, configuration files'
  );
  console.log(
    '    and scripts into the app directory. If you do this, you can’t go back!'
  );
  console.log();
  console.log('We suggest that you begin by typing:');
  console.log();
  console.log(chalk.cyan('  cd'), cdpath);
  console.log(`  ${chalk.cyan(`${displayedCommand} start`)}`);
  if (readmeExists) {
    console.log();
    console.log(
      chalk.yellow(
        'You had a `README.md` file, we renamed it to `README.old.md`'
      )
    );
  }
  console.log();
  console.log();
  installMorePackage(appName, appPath);
};

function isReactInstalled(appPackage) {
  const dependencies = appPackage.dependencies || {};

  return (
    typeof dependencies.react !== 'undefined' &&
    typeof dependencies['react-dom'] !== 'undefined'
  );
}

function questions() {
  return new Promise(function(resolve, reject) {
    rl.question('Do you need deployment file\n Type Y or N ? :', answer => {
      resolve(answer);
      rl.close();
    });
  });
}

function installDependency() {
  return new Promise(function(resolve, reject) {
    exec(
      'yarn add mobx mobx-react react-router-dom recompose styled-components',
      (err, stdout, stderr) => {
        if (err) {
          // node couldn't execute the command
          return;
        }
        resolve(true);
      }
    );
  });
}

function installDevDependency() {
  return new Promise(function(resolve, reject) {
    exec(
      'yarn add -D react-app-rewire-mobx react-app-rewired eslint prettier babel-eslint eslint-config-airbnb eslint-config-prettier eslint-plugin-flowtype eslint-plugin-import eslint-plugin-jsx-a11y eslint-plugin-prettier eslint-plugin-react @storybook/react @storybook/addon-actions @storybook/addon-links @storybook/addons',
      (err, stdout, stderr) => {
        if (err) {
          // node couldn't execute the command
          return;
        }
        resolve(true);
      }
    );
  });
}

function cloneDeploymentTemplate(appPath) {
  return new Promise(function(resolve, reject) {
    console.log('cloning Deployment Template');
    const repository =
      'https://gitlab.com/sendit-th/template-deployment-frontend.git';
    exec(`git clone ${repository}`, (err, stdout, stderr) => {
      if (err) {
        // node couldn't execute the command
        return;
      }
      console.log(`${stdout}`);
      fs.moveSync(
        `${appPath}/template-deployment-frontend/gitlab-ci.yml`,
        `${appPath}/.gitlab-ci.yml`
      );
      fs.moveSync(
        `${appPath}/template-deployment-frontend/deployment`,
        `${appPath}/deployment`
      );
      fs.removeSync(`${appPath}/template-deployment-frontend`);
      resolve(true);
    });
  });
}

async function renameFiles(packageName, appPath) {
  const defaultDeployment = {
    registryName: packageName,
    projectRepoName: packageName,
    helmProductionName: `prod-th-${packageName}`,
    nameOverride: `prod-th-${packageName}`,
    webHttp: `prod-th-${packageName}-http`,
  };
  const [
    gitlabCiYml,
    productionThYaml,
    stagingThYaml,
    developmentThYaml,
    nginxFile,
  ] = await Promise.all([
    fs.readFile(path.join(appPath, '.gitlab-ci.yml')),
    fs.readFile(path.join(appPath, 'deployment', 'values-production.yaml')),
    fs.readFile(path.join(appPath, 'deployment', 'values-staging.yaml')),
    fs.readFile(path.join(appPath, 'deployment', 'values-development.yaml')),
    fs.readFile(
      path.join(appPath, 'deployment', 'nginx', 'conf.d', 'site.conf')
    ),
  ]);
  await Promise.all([
    fs.writeFile(
      path.join(appPath, '.gitlab-ci.yml'),
      _.template(gitlabCiYml.toString())(defaultDeployment)
    ),
    fs.writeFile(
      path.join(appPath, 'deployment', 'values-production.yaml'),
      _.template(productionThYaml.toString())(defaultDeployment)
    ),
    fs.writeFile(
      path.join(appPath, 'deployment', 'values-staging.yaml'),
      _.template(stagingThYaml.toString())(defaultDeployment)
    ),
    fs.writeFile(
      path.join(appPath, 'deployment', 'values-development.yaml'),
      _.template(developmentThYaml.toString())(defaultDeployment)
    ),
    fs.writeFile(
      path.join(appPath, 'deployment', 'nginx', 'conf.d', 'site.conf'),
      _.template(nginxFile.toString())(defaultDeployment)
    ),
  ]);
}

async function installMorePackage(appName, appPath) {
  const answer = await questions();
  console.log(appPath);
  console.log('installing .......');
  if (answer === 'y' || answer === 'Y') {
    await installDependency();
    await installDevDependency();
    await cloneDeploymentTemplate(appPath);
    renameFiles(appName, appPath);
  } else {
    await installDependency();
    await installDevDependency();
    console.log('Happy hacking!');
  }
}
