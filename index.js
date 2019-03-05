const debug = require('debug')('mongoose-publisher');
const mongoose = require('mongoose');
const _ = require('lodash');

function publisherPlugin(schema, options = {}) {
    if (!options.collection) throw new Error('You must specify a collection name in your schema');
    let log = debug.extend(options.collection);
    let pluginOptions = {
        suffix: '_draft',
        ...options
    };
    let collectionName = options.collection;
    let collectionDraftName = collectionName + pluginOptions.suffix;
    log('start with options %O', pluginOptions);
    log('collection publish : %s', collectionName);
    log('collection draft : %s', collectionDraftName);
    let PublishedModel = mongoose.model(getPublishedModelName(collectionName), schema, options.collection);

    function getPublishedModelName(collectionName){
        return `${_.capitalize(collectionName)}Published`;
    }

    schema.set('collection', collectionDraftName);

    schema.add({
        _p: {type: Boolean, default: false, select: true},
        draftPublished: {type: Boolean, default: false},
        version: {
            type: Number,
            default: 0
        },
        publishedVersion: {type: Number, default: 0}
    });

    schema.query.publisher = function (published = false) {
        return this.setOptions({published : !!published});
    };

    schema.query.publisherPopulate = function (population) {
        population.options = {
            published: !!this.getOptions().published,
            ...population.options
        };
        return this.populate(population);
    };

    schema.methods.publisherPopulate = function (population) {
        population.options = {
            published: !!this._p,
            ...population.options
        };
        return this.populate(population);
    };

    schema.methods.publish = async function () {
        this.set({draftPublished: true, publishedVersion: this.version});
        await this.model(this.constructor.modelName).findOneAndUpdate({_id: this._id}, {
            ...this.toObject(),
            _p: true
        }, {
            upsert: true,
            new: true,
            strict: false,
            published: true
        });
        await this.updateOne({draftPublished: true, publishedVersion: this.version});
        return this;
    };

    schema.methods.unpublish = async function () {
        this.set({draftPublished: false});
        await this.model(this.constructor.modelName).findOneAndRemove({_id: this._id}, {
            published: true
        });
        await this.updateOne({draftPublished: false});
        return this;
    };

    schema.statics.clearPublisherFields = function(unclear){
        return _.omit(unclear, [
            '_p',
            'draftPublished',
            'version',
            'publishedVersion'
        ])
    };

    async function preMiddleware() {
        if(this.collection && this.getOptions && !!this.getOptions().published){
            this.collection(PublishedModel.collection);
        }
    }

    schema.pre('remove', async function() {
        !this._p && await this.model(this.constructor.modelName).findOneAndRemove({_id: this._id}).setOptions({published:true});
    });

    schema.pre('save', function (next) {
        if (this.version === this.publishedVersion && this.draftPublished && !this._p) ++this.version;
        this._p = false;
        next();
    });

    schema.pre('countDocuments', preMiddleware);
    schema.pre('count', preMiddleware);
    schema.pre('find', preMiddleware);
    schema.pre('findOne', preMiddleware);
    schema.pre('findOneAndRemove', preMiddleware);
    schema.pre('findOneAndUpdate', preMiddleware);
    schema.pre('update', preMiddleware);
    schema.pre('updateOne', preMiddleware);
    schema.pre('updateMany', preMiddleware);
}

module.exports = {publisherPlugin};