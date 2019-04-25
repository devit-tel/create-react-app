import React from 'react'
import ReactDOM from 'react-dom'

import App from './core/App'
import './index.css'
import * as serviceWorker from './serviceWorker'

ReactDOM.render(<App />, document.getElementById('root'))

if (module.hot) {
  module.hot.accept('./core/App', () => {
    ReactDOM.render(<App />, document.getElementById('root'))
  })
}

serviceWorker.unregister()