module.exports = {
    target: 'web',
    entry: {
        "app": "./src/app.ts"
    },
    output: {
        filename: "[name].js",
        path: __dirname + "/build/",
        libraryTarget: "umd"

    },

    devtool: "source-map",

    resolve: {
        extensions: [".ts", ".tsx", ".js", ".json"]
    },

    module: {
        rules: [
            { test: /\.tsx?$/, loader: "ts-loader" },

            { enforce: "pre", test: /\.js$/, loader: "source-map-loader" }
        ]
    },

    externals: {
        "moduleA": "moduleA"
    }

};
